import type { Handler } from 'hono';
import { appResponse } from '../http/responses';
import { type App } from '../runtime/context';
import { type Submission, type Upload } from '../domain/models';
import { iso } from '../utils/time';
import { sql } from '../infrastructure/database/query';
import { field, htmx } from '../http/requests';
import { history, newSubmission, submissionForm, success } from '../views/submissions';
import { type View } from '../views/types';
import { metadataErrors } from '../domain/media';
import { verifyObject } from '../infrastructure/storage/r2';
export const submissionHistory: Handler<App> = async (c) => {
  const rows = await sql(
    c.env,
    `SELECT id,title,notes,original_filename,media_kind,content_type,byte_size,created_at FROM submissions WHERE user_id=? ORDER BY created_at DESC`,
    c.get('user')!.id,
  ).all<Submission>();
  return appResponse(
    c,
    history({ csrf_token: c.get('session').csrf_token, submissions: rows.results }),
  );
};
export const submissionPage: Handler<App> = (c) => appResponse(c, newSubmission({ csrf_token: c.get('session').csrf_token }));
export const createSubmission: Handler<App> = async (c) => {
  const title = field(c, 'title'),
    notes = field(c, 'notes');
  const v: View = { csrf_token: c.get('session').csrf_token, form_title: title, form_notes: notes };
  const errors = metadataErrors(title, notes);
  const upload = await sql(
    c.env,
    'SELECT * FROM uploads WHERE id=? AND user_id=?',
    field(c, 'upload_id'),
    c.get('user')!.id,
  ).first<Upload>();
  if (!upload || !['complete', 'bound'].includes(upload.phase)) errors.push('error.upload');
  if (errors.length)
    return appResponse(
      c,
      htmx(c) ? submissionForm({ ...v, errors }) : newSubmission({ ...v, errors }),
    );
  let submission = await sql(
    c.env,
    'SELECT * FROM submissions WHERE upload_id=? AND user_id=?',
    upload!.id,
    c.get('user')!.id,
  ).first<Submission>();
  if (!submission) {
    const object = await verifyObject(c.env, upload!);
    if (object.etag !== upload!.etag)
      return appResponse(c, submissionForm({ ...v, errors: ['error.upload'] }));
    const id = crypto.randomUUID();
    await c.env.DB.batch([
      sql(
        c.env,
        `INSERT INTO submissions(id,user_id,title,notes,original_filename,media_kind,content_type,byte_size,storage_ref,created_at,status,upload_id,r2_etag,ia_item,lifecycle)
        SELECT ?,user_id,?,?,original_filename,media_kind,content_type,byte_size,object_key,?,'staged',id,etag,?,'pending' FROM uploads WHERE id=? AND user_id=? AND phase='complete' ON CONFLICT(upload_id) DO NOTHING`,
        id,
        title,
        notes || null,
        iso(),
        `${c.env.IA_ITEM_PREFIX}-${id}`,
        upload!.id,
        c.get('user')!.id,
      ),
      sql(
        c.env,
        `UPDATE uploads SET phase='bound' WHERE id=? AND phase='complete' AND EXISTS(SELECT 1 FROM submissions WHERE upload_id=?)`,
        upload!.id,
        upload!.id,
      ),
    ]);
    submission = await sql(
      c.env,
      'SELECT * FROM submissions WHERE upload_id=? AND user_id=?',
      upload!.id,
      c.get('user')!.id,
    ).first<Submission>();
  }
  if (!submission) return appResponse(c, submissionForm({ ...v, errors: ['error.upload'] }));
  return appResponse(c, success({ ...v, submission }));
};
