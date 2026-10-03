import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach } from 'vitest';
import { type Env as WorkerEnv } from '../src/runtime/bindings';
declare module 'cloudflare:workers' {
  interface Env extends WorkerEnv {}
}
const bindings = env as unknown as WorkerEnv & {
  MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
};
beforeAll(async () => {
  await applyD1Migrations(bindings.DB, bindings.MIGRATIONS);
});
beforeEach(async () => {
  for (const table of [
    'outbox',
    'transfer_parts',
    'transfer_jobs',
    'submissions',
    'upload_parts',
    'uploads',
    'sessions',
    'login_challenges',
    'users',
    'migration_imports',
  ])
    await bindings.DB.prepare(`DELETE FROM ${table}`).run();
  await bindings.DB.prepare(
    'UPDATE storage_control SET reservations_enabled=1,discrepancy=NULL',
  ).run();
  let cursor: string | undefined;
  do {
    const list = await bindings.STAGING_BUCKET.list({ cursor });
    for (const object of list.objects) await bindings.STAGING_BUCKET.delete(object.key);
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
});
