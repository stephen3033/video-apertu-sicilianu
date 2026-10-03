import { type Env } from '../runtime/bindings';
import { type Job, type JobMessage } from '../domain/models';
import { now } from '../utils/time';
import { sql } from '../infrastructure/database/query';


import { processJob, deadLetter } from './publication';
import { dispatchOutbox } from './outbox';
export async function consume(env: Env, batch: MessageBatch<JobMessage>) {
  for (const message of batch.messages) {
    const data = message.body;
    if (
      !data ||
      typeof data.job_id !== 'string' ||
      !Number.isInteger(data.generation) ||
      !Number.isInteger(data.step)
    ) {
      message.ack();
      continue;
    }
    try {
      if (batch.queue === env.DEAD_LETTER_QUEUE) await deadLetter(env, data);
      else {
        const job = await sql(
          env,
          'SELECT * FROM transfer_jobs WHERE id=?',
          data.job_id,
        ).first<Job>();
        if (
          job &&
          job.generation === data.generation &&
          job.step === data.step &&
          !['done', 'failed'].includes(job.state) &&
          (job.lease_until > now() || job.next_attempt_at > now())
        ) {
          message.retry({
            delaySeconds: Math.max(
              1,
              Math.min(3600, Math.max(job.lease_until, job.next_attempt_at) - now()),
            ),
          });
          continue;
        }
        await processJob(env, data);
      }
      message.ack();
    } catch {
      message.retry({ delaySeconds: Math.min(3600, 30 * 2 ** Math.min(message.attempts, 7)) });
    }
  }
  await dispatchOutbox(env);
}
