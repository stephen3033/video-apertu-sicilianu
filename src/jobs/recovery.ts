import { type Env } from '../runtime/bindings';
import { type Upload } from '../domain/models';
import { now, iso } from '../utils/time';
import { sql } from '../infrastructure/database/query';

import { cleanupUpload, verifyObject, multipartInventory } from '../infrastructure/storage/r2';
import { dispatchOutbox } from './outbox';
export async function recover(env: Env) {
  await sql(
    env,
    `UPDATE uploads SET phase='cleanup' WHERE expires_at<=? AND lease_until<=? AND phase IN ('initializing','uploading','completing','complete') RETURNING *`,
    now(),
    now(),
  ).all<Upload>();
  const cleanup = await sql(
    env,
    `SELECT * FROM uploads WHERE phase='cleanup' LIMIT 50`,
  ).all<Upload>();
  for (const upload of cleanup.results)
    try {
      await cleanupUpload(env, upload);
    } catch {
      console.log(JSON.stringify({ event: 'upload_cleanup_retry', upload_id: upload.id }));
    }
  // Incomplete completion after a lost acknowledgement can be recovered before expiry.
  const completing = await sql(
    env,
    `SELECT * FROM uploads WHERE phase='completing' AND lease_until<? AND expires_at>? LIMIT 50`,
    now(),
    now(),
  ).all<Upload>();
  for (const upload of completing.results) {
    try {
      const object = await verifyObject(env, upload);
      await sql(
        env,
        `UPDATE uploads SET phase='complete',status='staged',etag=?,lease_until=0,lease_token=NULL WHERE id=? AND phase='completing' AND lease_until<?`,
        object.etag,
        upload.id,
        now(),
      ).run();
    } catch {
      /* No complete object yet; owner can retry or the expiry pass aborts. */
    }
  }
  await env.DB.batch([
    sql(env, `DELETE FROM sessions WHERE expires_at<=?`, now()),
    sql(env, `DELETE FROM login_challenges WHERE created_at<?`, iso(now() - 86400)),
    sql(
      env,
      `UPDATE outbox SET sent_at=NULL WHERE sent_at<? AND EXISTS(SELECT 1 FROM transfer_jobs j WHERE j.id=outbox.job_id AND j.generation=outbox.generation AND j.step=outbox.step AND j.state NOT IN ('done','failed') AND j.lease_until<=? AND j.next_attempt_at<=?)`,
      now() - 1200,
      now(),
      now(),
    ),
    sql(
      env,
      `INSERT OR IGNORE INTO outbox(job_id,generation,step,created_at) SELECT id,generation,step,? FROM transfer_jobs WHERE state NOT IN ('done','failed') AND lease_until<=?`,
      now(),
      now(),
    ),
  ]);
  await dispatchOutbox(env);
  try {
    await reconcile(env);
  } catch {
    await sql(
      env,
      "UPDATE storage_control SET reservations_enabled=0,discrepancy='reconciliation_unavailable' WHERE id=1",
    ).run();
    console.log(
      JSON.stringify({ event: 'storage_reconciliation_failed', category: 'inventory_unavailable' }),
    );
  }
}
export async function reconcile(env: Env) {
  // Observe unknown/mismatched objects and fail closed. Do not delete unknown data
  // or re-enable reservations automatically; an operator resolves discrepancies.
  let cursor: string | undefined;
  let discrepancy = false;
  let bytes = 0;
  do {
    const listing = await env.STAGING_BUCKET.list({ cursor, limit: 500 });
    for (const object of listing.objects) {
      bytes += object.size;
      const upload = await sql(
        env,
        `SELECT byte_size,status,phase,etag,id FROM uploads WHERE object_key=?`,
        object.key,
      ).first<Upload>();
      if (
        !upload ||
        (upload.status === 'released' && (await env.STAGING_BUCKET.head(object.key))) ||
        upload.byte_size !== object.size ||
        (upload.etag && upload.etag !== object.etag)
      )
        discrepancy = true;
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
  if (env.APP_ENV !== 'local') {
    const seen = new Set<string>();
    for await (const multipart of multipartInventory(env)) {
      const upload = await sql(
        env,
        'SELECT * FROM uploads WHERE object_key=?',
        multipart.Key || '',
      ).first<Upload>();
      if (
        !upload ||
        upload.status === 'released' ||
        seen.has(multipart.Key!) ||
        (upload.multipart_id && upload.multipart_id !== multipart.UploadId)
      )
        discrepancy = true;
      seen.add(multipart.Key!);
    }
  }
  const retained = await sql(
    env,
    `SELECT * FROM uploads WHERE phase IN ('complete','bound') AND status<>'released'`,
  ).all<Upload>();
  for (const upload of retained.results) {
    const object = await env.STAGING_BUCKET.head(upload.object_key);
    if (!object) {
      // Deletion may be between its storage and D1 commits. A fresh lifecycle read
      // distinguishes authorized cleanup from unexpected loss.
      const cleanup = await sql(
        env,
        `SELECT id FROM submissions WHERE upload_id=? AND lifecycle IN ('cleanup_pending','published','rejected')`,
        upload.id,
      ).first();
      if (!cleanup) discrepancy = true;
    }
  }
  await sql(
    env,
    `UPDATE storage_control SET last_reconciled_at=?,reservations_enabled=CASE WHEN ?=1 THEN 0 ELSE reservations_enabled END,discrepancy=CASE WHEN ?=1 THEN 'storage_inventory_mismatch' ELSE discrepancy END WHERE id=1`,
    now(),
    Number(discrepancy),
    Number(discrepancy),
  ).run();
  console.log(JSON.stringify({ event: 'storage_reconciled', stored_bytes: bytes, discrepancy }));
}
