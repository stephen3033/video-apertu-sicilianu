import type { Handler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { reviewContent } from '../views/review';
import { type App, type Ctx } from '../runtime/context';
import { type Submission } from '../domain/models';
import { iso, now } from '../utils/time';
import { sql } from '../infrastructure/database/query';

import { text } from '../views/helpers';
import { appResponse } from '../http/responses';
import { dispatchOutbox, outboxInsert } from '../jobs/outbox';
export async function reviewPage(c: Ctx) {
  const rows = await sql(
    c.env,
    `SELECT s.*,u.email,j.last_error FROM submissions s JOIN users u ON u.id=s.user_id LEFT JOIN transfer_jobs j ON j.submission_id=s.id ORDER BY CASE WHEN s.review_decision='pending' THEN 0 WHEN s.lifecycle='failed' THEN 1 ELSE 2 END,s.created_at`,
  ).all<Submission>();
  const totals = await sql(
    c.env,
    `SELECT COALESCE((SELECT SUM(byte_size) FROM uploads WHERE status<>'released'),0) AS bytes,(SELECT COUNT(*) FROM submissions WHERE lifecycle='cleanup_pending') AS cleanup,(SELECT MIN(created_at) FROM submissions WHERE review_decision='pending') AS oldest_pending,(SELECT MIN(created_at) FROM transfer_jobs WHERE state NOT IN ('done','failed')) AS oldest_job`,
  ).first<{ bytes: number; cleanup: number; oldest_pending: string; oldest_job: number }>();
  const html = reviewContent(rows.results, totals, c.get('session').csrf_token);
  return appResponse(c, html);
}
export const downloadSubmission: Handler<App> = async (c) => {
  const s = await sql(
    c.env,
    'SELECT * FROM submissions WHERE id=?',
    c.req.param('id')!,
  ).first<Submission>();
  if (!s || ['legacy', 'published', 'rejected'].includes(s.lifecycle)) return c.notFound();
  let range: R2Range | undefined;
  const header = c.req.header('Range');
  if (header) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(header);
    if (!match || (!match[1] && !match[2]))
      return c.body(null, 416, { 'Content-Range': `bytes */${s.byte_size}` });
    let start: number, end: number;
    if (!match[1]) {
      const suffix = Number(match[2]);
      start = Math.max(0, s.byte_size - suffix);
      end = s.byte_size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), s.byte_size - 1) : s.byte_size - 1;
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= s.byte_size
    )
      return c.body(null, 416, { 'Content-Range': `bytes */${s.byte_size}` });
    range = { offset: start, length: end - start + 1 };
  }
  const object = await c.env.STAGING_BUCKET.get(s.storage_ref, {
    range,
    onlyIf: { etagMatches: s.r2_etag },
  });
  if (!object || !('body' in object)) return c.notFound();
  const headers = new Headers({
    'Content-Type': s.content_type,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Accept-Ranges': 'bytes',
    ETag: object.httpEtag,
  });
  const ascii = s.original_filename.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180) || 'recording';
  const encoded = encodeURIComponent(s.original_filename).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16),
  );
  headers.set(
    'Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
  );
  headers.set('Content-Length', String(range && 'length' in range ? range.length : s.byte_size));
  if (range && 'offset' in range)
    headers.set(
      'Content-Range',
      `bytes ${range.offset}-${range.offset! + range.length! - 1}/${s.byte_size}`,
    );
  return new Response(object.body, { status: range ? 206 : 200, headers });
};
export const reviewDecision: Handler<App> = async (c) => {
  const id = c.req.param('id')!,
    action = c.req.param('action')!;
  if (!['accept', 'reject', 'retry'].includes(action)) return c.notFound();
  const reviewer = c.get('user')!;
  if (action === 'retry') {
    await c.env.DB.batch([
      sql(
        c.env,
        `UPDATE transfer_jobs SET state=COALESCE(resume_state,'queued'),resume_state=NULL,generation=generation+1,attempts=0,next_attempt_at=0,last_error=NULL,lease_until=0,lease_token=NULL,updated_at=? WHERE submission_id=? AND state='failed' AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_reviewer=1)`,
        now(),
        id,
        reviewer.id,
      ),
      sql(
        c.env,
        `UPDATE submissions SET lifecycle=CASE WHEN review_decision='rejected' OR upstream_url IS NOT NULL THEN 'cleanup_pending' ELSE 'transferring' END,last_error=NULL WHERE id=? AND lifecycle='failed' AND EXISTS(SELECT 1 FROM transfer_jobs WHERE submission_id=? AND state<>'failed')`,
        id,
        id,
      ),
      sql(
        c.env,
        `INSERT OR IGNORE INTO outbox(job_id,generation,step,created_at) SELECT id,generation,step,? FROM transfer_jobs WHERE submission_id=? AND state NOT IN ('done','failed')`,
        now(),
        id,
      ),
    ]);
  } else {
    // The review decision, job, and outbox entry commit together; competing choices cannot win.
    const decision = action === 'accept' ? 'accepted' : 'rejected';
    const jobId = crypto.randomUUID();
    await c.env.DB.batch([
      sql(
        c.env,
        `UPDATE submissions SET review_decision=?,reviewed_by=?,reviewed_at=?,lifecycle=? WHERE id=? AND review_decision='pending' AND lifecycle='pending' AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_reviewer=1)`,
        decision,
        reviewer.id,
        iso(),
        action === 'accept' ? 'approved' : 'cleanup_pending',
        id,
        reviewer.id,
      ),
      sql(
        c.env,
        `INSERT INTO transfer_jobs(id,submission_id,kind,state,created_at,updated_at) SELECT ?,id,?,?,?,? FROM submissions WHERE id=? AND review_decision=? AND reviewed_by=? ON CONFLICT(submission_id) DO NOTHING`,
        jobId,
        action === 'accept' ? 'publish' : 'delete',
        action === 'accept' ? 'queued' : 'cleanup',
        now(),
        now(),
        id,
        decision,
        reviewer.id,
      ),
      outboxInsert(c.env, jobId),
    ]);
  }
  const submission = await sql(
    c.env,
    'SELECT review_decision FROM submissions WHERE id=?',
    id,
  ).first<{ review_decision: string }>();
  if (!submission) return c.notFound();
  if (
    action !== 'retry' &&
    submission.review_decision !== (action === 'accept' ? 'accepted' : 'rejected')
  )
    throw new HTTPException(409, { message: 'error.review_conflict' });
  c.executionCtx.waitUntil(
    dispatchOutbox(c.env).catch(() =>
      console.log(JSON.stringify({ event: 'outbox_dispatch_deferred' })),
    ),
  );
  return reviewPage(c);
};
