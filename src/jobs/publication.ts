import { type Env } from '../runtime/bindings';
import { type Job, type JobMessage, type Submission, type Upload } from '../domain/models';
import { now, iso } from '../utils/time';
import { sql } from '../infrastructure/database/query';
import { SINGLE_LIMIT, TRANSFER_PART } from '../domain/limits';
import { ArchiveError, archiveFile, archiveRequest, archiveURL, metadata, multipartETag, objectSource, smallXML, transferPartSize, upstreamMatches, xmlEscape, xmlValue } from '../infrastructure/archive/client';

import { outboxInsert } from './outbox';
function owns(env: Env, j: Job) {
  return sql(
    env,
    `SELECT id FROM transfer_jobs WHERE id=? AND generation=? AND step=? AND lease_token=? AND lease_until>?`,
    j.id,
    j.generation,
    j.step,
    j.lease_token,
    now(),
  );
}
async function advance(
  env: Env,
  j: Job,
  state: string,
  lifecycle?: string,
  extra: { multipart?: string; expected?: string } = {},
) {
  await env.DB.batch([
    sql(
      env,
      `UPDATE transfer_jobs SET state=?,step=step+1,lease_token=NULL,lease_until=0,attempts=0,next_attempt_at=0,last_error=NULL,updated_at=?,multipart_id=COALESCE(?,multipart_id),expected_etag=COALESCE(?,expected_etag) WHERE id=? AND generation=? AND step=? AND lease_token=? AND lease_until>?`,
      state,
      now(),
      extra.multipart || null,
      extra.expected || null,
      j.id,
      j.generation,
      j.step,
      j.lease_token,
      now(),
    ),
    ...(lifecycle
      ? [
          sql(
            env,
            `UPDATE submissions SET lifecycle=?,last_error=NULL WHERE id=? AND EXISTS(SELECT 1 FROM transfer_jobs WHERE id=? AND generation=? AND step=?)`,
            lifecycle,
            j.submission_id,
            j.id,
            j.generation,
            j.step + 1,
          ),
        ]
      : []),
    outboxInsert(env, j.id),
  ]);
  console.log(
    JSON.stringify({
      event: 'transfer_stage',
      job_id: j.id,
      state,
      generation: j.generation,
      step: j.step + 1,
    }),
  );
}
async function accepted(env: Env, j: Job, s: Submission) {
  const url = `https://archive.org/download/${encodeURIComponent(s.ia_item)}/${encodeURIComponent(archiveFile(s))}`;
  await env.DB.batch([
    sql(
      env,
      `UPDATE submissions SET lifecycle='upstream_accepted',upstream_url=? WHERE id=? AND EXISTS(SELECT 1 FROM transfer_jobs WHERE id=? AND lease_token=? AND lease_until>?)`,
      url,
      s.id,
      j.id,
      j.lease_token,
      now(),
    ),
    sql(
      env,
      `UPDATE transfer_jobs SET state='cleanup',step=step+1,lease_token=NULL,lease_until=0,attempts=0,updated_at=? WHERE id=? AND lease_token=? AND lease_until>?`,
      now(),
      j.id,
      j.lease_token,
      now(),
    ),
    outboxInsert(env, j.id),
  ]);
  // The upstream receipt is committed before any staging deletion. Try cleanup now;
  // the durable cleanup outbox remains available if this invocation is interrupted.
  await processJob(env, { job_id: j.id, generation: j.generation, step: j.step + 1 });
}
async function cleanupSubmission(env: Env, j: Job, s: Submission) {
  if (j.kind === 'publish' && !s.upstream_url) throw new ArchiveError('missing_upstream_receipt');
  await sql(
    env,
    `UPDATE submissions SET lifecycle='cleanup_pending' WHERE id=? AND EXISTS(SELECT 1 FROM transfer_jobs WHERE id=? AND lease_token=? AND lease_until>?)`,
    s.id,
    j.id,
    j.lease_token,
    now(),
  ).run();
  if (!(await owns(env, j).first())) return;
  await env.STAGING_BUCKET.delete(s.storage_ref);
  if (await env.STAGING_BUCKET.head(s.storage_ref)) throw new ArchiveError('cleanup_unconfirmed');
  await env.DB.batch([
    sql(
      env,
      `UPDATE uploads SET phase='released',status='released' WHERE id=? AND EXISTS(SELECT 1 FROM transfer_jobs WHERE id=? AND lease_token=? AND lease_until>?)`,
      s.upload_id,
      j.id,
      j.lease_token,
      now(),
    ),
    sql(
      env,
      `UPDATE submissions SET lifecycle=?,published_at=? WHERE id=? AND EXISTS(SELECT 1 FROM transfer_jobs WHERE id=? AND lease_token=? AND lease_until>?)`,
      j.kind === 'publish' ? 'published' : 'rejected',
      j.kind === 'publish' ? iso() : null,
      s.id,
      j.id,
      j.lease_token,
      now(),
    ),
    sql(
      env,
      `UPDATE transfer_jobs SET state='done',step=step+1,lease_token=NULL,lease_until=0,updated_at=?,last_error=NULL WHERE id=? AND lease_token=? AND lease_until>?`,
      now(),
      j.id,
      j.lease_token,
      now(),
    ),
  ]);
}
export async function processJob(env: Env, message: JobMessage): Promise<void> {
  const current = await sql(
    env,
    'SELECT * FROM transfer_jobs WHERE id=? AND generation=? AND step=?',
    message.job_id,
    message.generation,
    message.step,
  ).first<Job>();
  if (current && current.attempts >= 9) {
    await deadLetter(env, message);
    return;
  }
  const token = crypto.randomUUID();
  const lease = await sql(
    env,
    `UPDATE transfer_jobs SET lease_token=?,lease_until=?,total_attempts=total_attempts+1,updated_at=? WHERE id=? AND generation=? AND step=? AND state NOT IN ('done','failed') AND lease_until<=? AND next_attempt_at<=? RETURNING *`,
    token,
    now() + 900,
    now(),
    message.job_id,
    message.generation,
    message.step,
    now(),
    now(),
  ).first<Job>();
  if (!lease) return;
  const j = lease;
  const deadline = Date.now() + 600000;
  try {
    const s = await sql(
      env,
      'SELECT * FROM submissions WHERE id=?',
      j.submission_id,
    ).first<Submission>();
    if (!s) throw new ArchiveError('submission_missing');
    if (j.kind === 'delete' || j.state === 'cleanup') {
      await cleanupSubmission(env, j, s);
      return;
    }
    if (j.state === 'queued') {
      await advance(env, j, s.byte_size <= SINGLE_LIMIT ? 'part' : 'initiate', 'transferring');
      return;
    }
    // Recover a lost acknowledgement without retransmitting an accepted file.
    if (
      j.expected_etag &&
      ['part', 'complete', 'verify'].includes(j.state) &&
      (await upstreamMatches(env, s, j.expected_etag, deadline))
    ) {
      await accepted(env, j, s);
      return;
    }
    if (j.state === 'initiate') {
      // An initiation acknowledgement may be lost. Find the existing upload for
      // this immutable target before creating another multipart session.
      const inventory = await archiveRequest(
        env,
        `https://s3.us.archive.org/${encodeURIComponent(s.ia_item)}?uploads&prefix=${encodeURIComponent(archiveFile(s))}`,
        'GET',
        {},
        undefined,
        undefined,
        deadline,
      );
      if (inventory.status !== 404) {
        const listing = await smallXML(inventory);
        if (
          !listing.includes('ListMultipartUploadsResult') ||
          xmlValue(listing, 'IsTruncated') === 'true'
        )
          throw new ArchiveError('archive_multipart_inventory');
        for (const block of listing.match(/<Upload>[\s\S]*?<\/Upload>/g) || []) {
          const previousId = xmlValue(block, 'UploadId');
          if (xmlValue(block, 'Key') === archiveFile(s) && previousId) {
            await advance(env, j, 'part', undefined, { multipart: previousId });
            return;
          }
        }
      } else await inventory.body?.cancel();
      const response = await archiveRequest(
        env,
        archiveURL(s) + '?uploads',
        'POST',
        metadata(s),
        undefined,
        undefined,
        deadline,
      );
      const xml = await smallXML(response);
      const id = xmlValue(xml, 'UploadId');
      if (!id || !xml.includes('InitiateMultipartUploadResult'))
        throw new ArchiveError('archive_multipart_init');
      await advance(env, j, 'part', undefined, { multipart: id });
      return;
    }
    if (j.state === 'part' && s.byte_size <= SINGLE_LIMIT) {
      let digest = '';
      const source = objectSource(env, s, 0, s.byte_size, async (md5) => {
        digest = md5;
        await sql(
          env,
          'UPDATE transfer_jobs SET expected_etag=? WHERE id=? AND lease_token=?',
          md5,
          j.id,
          j.lease_token,
        ).run();
      });
      const response = await archiveRequest(
        env,
        archiveURL(s),
        'PUT',
        { ...metadata(s), 'Content-Type': s.content_type, 'Content-Length': String(s.byte_size) },
        source,
        undefined,
        deadline,
      );
      const etag = response.headers.get('ETag')?.replace(/^"|"$/g, '');
      await smallXML(response);
      if (!digest || etag !== digest) throw new ArchiveError('archive_upload_etag');
      await accepted(env, j, s);
      return;
    }
    if (j.state === 'part') {
      const parts = await sql(
        env,
        'SELECT part_number,etag,byte_size FROM transfer_parts WHERE job_id=? ORDER BY part_number',
        j.id,
      ).all<{ part_number: number; etag: string; byte_size: number }>();
      if (parts.results.length === Math.ceil(s.byte_size / TRANSFER_PART)) {
        await advance(env, j, 'complete', undefined, { expected: multipartETag(parts.results) });
        return;
      }
      const n = parts.results.length + 1,
        size = transferPartSize(s, n);
      if (size <= 0 || !j.multipart_id) throw new ArchiveError('archive_part_state');
      let digest = '';
      const response = await archiveRequest(
        env,
        `${archiveURL(s)}?partNumber=${n}&uploadId=${encodeURIComponent(j.multipart_id)}`,
        'PUT',
        { 'Content-Length': String(size), 'Content-Type': s.content_type },
        objectSource(env, s, (n - 1) * TRANSFER_PART, size, async (md5) => {
          digest = md5;
        }),
        undefined,
        deadline,
      );
      const etag = response.headers.get('ETag')?.replace(/^"|"$/g, '');
      await smallXML(response);
      if (!etag || etag !== digest) throw new ArchiveError('archive_part_etag');
      await sql(
        env,
        `INSERT INTO transfer_parts(job_id,part_number,byte_size,etag) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM transfer_jobs WHERE id=? AND lease_token=? AND lease_until>?) ON CONFLICT(job_id,part_number) DO UPDATE SET etag=excluded.etag,byte_size=excluded.byte_size`,
        j.id,
        n,
        size,
        etag,
        j.id,
        j.lease_token,
        now(),
      ).run();
      const all = [...parts.results, { part_number: n, etag, byte_size: size }];
      const last = n === Math.ceil(s.byte_size / TRANSFER_PART);
      await advance(
        env,
        j,
        last ? 'complete' : 'part',
        undefined,
        last ? { expected: multipartETag(all) } : {},
      );
      return;
    }
    if (j.state === 'complete') {
      const parts = await sql(
        env,
        'SELECT part_number,etag,byte_size FROM transfer_parts WHERE job_id=? ORDER BY part_number',
        j.id,
      ).all<{ part_number: number; etag: string; byte_size: number }>();
      if (
        parts.results.length !== Math.ceil(s.byte_size / TRANSFER_PART) ||
        parts.results.some(
          (p, i) => p.part_number !== i + 1 || p.byte_size !== transferPartSize(s, i + 1),
        )
      )
        throw new ArchiveError('archive_checkpoint');
      const xml =
        '<CompleteMultipartUpload>' +
        parts.results
          .map(
            (p) =>
              `<Part><PartNumber>${p.part_number}</PartNumber><ETag>"${xmlEscape(p.etag)}"</ETag></Part>`,
          )
          .join('') +
        '</CompleteMultipartUpload>';
      const response = await archiveRequest(
        env,
        `${archiveURL(s)}?uploadId=${encodeURIComponent(j.multipart_id!)}`,
        'POST',
        { 'Content-Type': 'application/xml' },
        undefined,
        xml,
        deadline,
      );
      const result = await smallXML(response);
      if (
        !result.includes('CompleteMultipartUploadResult') ||
        xmlValue(result, 'ETag')?.replace(/^"|"$/g, '') !== j.expected_etag
      )
        throw new ArchiveError('archive_completion');
      await accepted(env, j, s);
      return;
    }
    throw new ArchiveError('archive_unverified');
  } catch (error) {
    const category = error instanceof ArchiveError ? error.category : 'storage_or_database';
    const attempts = j.attempts + 1;
    await env.DB.batch([
      sql(
        env,
        `UPDATE transfer_jobs SET attempts=attempts+1,lease_token=NULL,lease_until=0,last_error=?,next_attempt_at=?,updated_at=? WHERE id=? AND lease_token=?`,
        category,
        now() + Math.min(3600, 30 * 2 ** Math.min(attempts, 7)),
        now(),
        j.id,
        token,
      ),
      sql(
        env,
        `UPDATE submissions SET last_error=? WHERE id=? AND EXISTS(SELECT 1 FROM transfer_jobs WHERE id=? AND generation=? AND step=?)`,
        category,
        j.submission_id,
        j.id,
        j.generation,
        j.step,
      ),
    ]);
    console.log(JSON.stringify({ event: 'transfer_retry', job_id: j.id, attempts, category }));
    throw new ArchiveError(category);
  }
}
export async function deadLetter(env: Env, message: JobMessage) {
  await env.DB.batch([
    sql(
      env,
      `UPDATE transfer_jobs SET resume_state=state,state='failed',lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND generation=? AND step=? AND state NOT IN ('done','failed') AND lease_until<=?`,
      now(),
      message.job_id,
      message.generation,
      message.step,
      now(),
    ),
    sql(
      env,
      `UPDATE submissions SET lifecycle='failed' WHERE id=(SELECT submission_id FROM transfer_jobs WHERE id=? AND generation=? AND step=? AND state='failed')`,
      message.job_id,
      message.generation,
      message.step,
    ),
  ]);
}
