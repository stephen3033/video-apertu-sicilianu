import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { readFile } from 'node:fs/promises';
import { importLegacy } from './import-legacy.mjs';
const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/local-import.mjs manifest.json');
const manifest = JSON.parse(await readFile(file, 'utf8'));
if (manifest.submissions.length)
  throw new Error(
    'Use the remote importer for source media; this local verification imports accounts only',
  );
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("local migration verification")}}',
    compatibilityDate: '2026-08-01',
    d1Databases: ['DB'],
  }),
);
try {
  const db = await mf.getD1Database('DB');
  await db
    .prepare(
      'CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TEXT DEFAULT CURRENT_TIMESTAMP)',
    )
    .run();
  async function migrate() {
    for (const migration of await readD1Migrations('migrations/d1'))
      if (
        !(await db
          .prepare('SELECT name FROM d1_migrations WHERE name=?')
          .bind(migration.name)
          .first())
      )
        await db.batch([
          ...migration.queries.map((q) => db.prepare(q)),
          db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(migration.name),
        ]);
  }
  await migrate();
  await migrate();
  const first = await importLegacy(manifest, db, {}, 'vas-local');
  await importLegacy(manifest, db, {}, 'vas-local');
  const checks = await db
    .prepare(
      'SELECT (SELECT COUNT(*) FROM users) accounts,(SELECT COUNT(*) FROM users WHERE is_reviewer<>0) reviewers,(SELECT COUNT(*) FROM sessions) sessions,(SELECT COUNT(*) FROM login_challenges) challenges,(SELECT COUNT(*) FROM migration_imports) imports,(SELECT COUNT(*) FROM d1_migrations) migrations',
    )
    .first();
  if (
    checks.accounts !== manifest.users.length ||
    checks.reviewers ||
    checks.sessions ||
    checks.challenges ||
    checks.imports !== 1 ||
    checks.migrations !== 2
  )
    throw new Error('Local import verification failed');
  console.log(JSON.stringify({ verified: true, ...first, ...checks }));
} finally {
  await mf.dispose();
}
