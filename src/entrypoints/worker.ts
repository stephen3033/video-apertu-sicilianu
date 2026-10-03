import { app } from '../http/app';
import { type Env } from '../runtime/bindings';
import { type JobMessage } from '../domain/models';
import { consume } from '../jobs/consumer';
import { recover } from '../jobs/recovery';
export default {
  fetch: app.fetch,
  queue: (batch: MessageBatch<JobMessage>, env: Env) => consume(env, batch),
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) =>
    ctx.waitUntil(recover(env)),
} satisfies ExportedHandler<Env, JobMessage>;
