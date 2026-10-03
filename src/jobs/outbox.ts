import { type Env } from '../runtime/bindings';
import { type JobMessage } from '../domain/models';
import { now } from '../utils/time';
import { sql } from '../infrastructure/database/query';


export const outboxInsert = (env: Env, jobId: string) =>
  sql(
    env,
    `INSERT OR IGNORE INTO outbox(job_id,generation,step,created_at) SELECT id,generation,step,? FROM transfer_jobs WHERE id=? AND state NOT IN ('done','failed')`,
    now(),
    jobId,
  );
export async function dispatchOutbox(env: Env) {
  const entries = await sql(
    env,
    `SELECT o.id,o.job_id,o.generation,o.step FROM outbox o JOIN transfer_jobs j ON j.id=o.job_id AND j.generation=o.generation AND j.step=o.step WHERE o.sent_at IS NULL AND j.state NOT IN ('done','failed') AND j.next_attempt_at<=? ORDER BY o.id LIMIT 50`,
    now(),
  ).all<JobMessage & { id: number }>();
  for (const entry of entries.results) {
    await env.PUBLICATION_QUEUE.send({
      job_id: entry.job_id,
      generation: entry.generation,
      step: entry.step,
    });
    await sql(
      env,
      'UPDATE outbox SET sent_at=? WHERE id=? AND sent_at IS NULL',
      now(),
      entry.id,
    ).run();
  }
}
