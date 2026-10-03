import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { build } from 'esbuild';
import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import http from 'node:http';
import { buildAssets } from '../build.mjs';
import { createArchive } from './archive.mjs';

export async function startRuntime({ test = false, port = test ? 8797 : 8787, controlPort = port + 1, stateDirectory, watchFiles = !test } = {}) {
  const ephemeral = test && !stateDirectory;
  const state = stateDirectory || (ephemeral ? await mkdtemp(join(tmpdir(), 'vas-e2e-')) : resolve('.local/development'));
  await mkdir(state, { recursive: true });
  const origin = `http://localhost:${port}`, controlOrigin = `http://localhost:${controlPort}`;
  const archive = await createArchive(join(state, 'archive'));
  const emails = new Map();
  const scriptPath = join(state, 'worker.mjs');
  const wrangler = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  async function compile() {
    await buildAssets();
    await build({ entryPoints: [wrangler.main], bundle: true, format: 'esm', platform: 'neutral', mainFields: ['browser', 'module', 'main'], conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], outfile: scriptPath });
  }
  await compile();
  const options = convertV4MiniflareOptions({
    log: new Log(process.env.VAS_LOCAL_DEBUG ? LogLevel.DEBUG : LogLevel.INFO),
    modules: true, scriptPath, modulesRoot: state,
    compatibilityDate: wrangler.compatibility_date,
    compatibilityFlags: wrangler.compatibility_flags,
    port, host: 'localhost', cf: false,
    unsafeTriggerHandlers: true,
    resourcePersistencePath: join(state, 'bindings'),
    d1Databases: { DB: 'vas-offline-db' },
    r2Buckets: { STAGING_BUCKET: 'vas-offline-staging' },
    queueProducers: { PUBLICATION_QUEUE: 'vas-local-publication' },
    queueConsumers: {
      'vas-local-publication': { maxBatchSize: 1, maxBatchTimeout: 0, maxRetries: 8, deadLetterQueue: 'vas-local-dead-letter' },
      'vas-local-dead-letter': { maxBatchSize: 1, maxBatchTimeout: 0 },
    },
    bindings: {
      ...wrangler.vars, APP_ENV: 'local', APP_ORIGIN: origin, LOCAL_UPLOAD_ORIGIN: controlOrigin,
      AUTH_CODE_SECRET: 'offline-development-only-do-not-deploy', EMAIL_BACKEND: 'test',
      IA_ACCESS_KEY: 'offline', IA_SECRET_KEY: 'offline',
    },
    serviceBindings: {
      TEST_EMAIL: async (request) => {
        const delivery = await request.json();
        emails.set(delivery.to, delivery);
        if (!test) console.log(`[login-code] to=${delivery.to} locale=${delivery.locale} code=${delivery.code}`);
        return new Response(null);
      },
      ASSETS: async (request) => {
        const path = new URL(request.url).pathname;
        if (!/^\/(static|vendor\/htmx)\/[a-zA-Z0-9/._ -]+$/.test(path) || path.includes('..')) return new Response(null, { status: 404 });
        try { return new Response(await readFile(`dist/public${path}`), { headers: { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'image/png' } }); }
        catch { return new Response(null, { status: 404 }); }
      },
    },
    outboundService: (request) => archive.fetch(request),
  });
  const mf = new Miniflare(options);
  let server, interval, debounce, watchers = [], rebuilding = Promise.resolve(), closing = false;
  async function stop() {
    if (closing) return;
    closing = true;
    clearInterval(interval); clearTimeout(debounce);
    for (const watcher of watchers) watcher.close();
    await rebuilding;
    if (server?.listening) await new Promise((done) => { server.close(done); server.closeAllConnections(); });
    await mf.dispose();
    if (ephemeral) await rm(state, { recursive: true, force: true });
  }
  try {
    await mf.ready;
    const db = await mf.getD1Database('DB');
    const bucket = await mf.getR2Bucket('STAGING_BUCKET');
    await db.prepare('CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TEXT DEFAULT CURRENT_TIMESTAMP)').run();
    for (const migration of await readD1Migrations('migrations/d1')) {
      if (!(await db.prepare('SELECT name FROM d1_migrations WHERE name=?').bind(migration.name).first())) {
        await db.batch([...migration.queries.map((query) => db.prepare(query)), db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(migration.name)]);
      }
    }
    async function recover() {
      const response = await mf.dispatchFetch(`${origin}/cdn-cgi/local/scheduled?cron=${encodeURIComponent('*/5 * * * *')}`);
      if (!response.ok) throw new Error(`Scheduled recovery failed: ${response.status}`);
      await response.text();
    }
    server = http.createServer((req, res) => {
      void (async () => {
        if (req.headers.host !== `localhost:${controlPort}`) { res.writeHead(403).end(); return; }
        const url = new URL(req.url, controlOrigin), params = url.searchParams;
        if (url.pathname.startsWith('/__local/uploads/')) {
          const upstream = http.request({ hostname: 'localhost', port, path: req.url, method: req.method, headers: { ...req.headers, host: `localhost:${port}` } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
          upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
          req.on('aborted', () => upstream.destroy());
          req.pipe(upstream); return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json');
        const json = (value) => res.end(JSON.stringify(value));
        if (req.method === 'POST' && (req.headers['x-vas-local-control'] !== '1' || (req.headers.origin && req.headers.origin !== controlOrigin))) { res.writeHead(403).end(); return; }
        if (url.pathname === '/health' && req.method === 'GET') return json({ ready: true, origin, offline: true });
        if (url.pathname === '/email' && req.method === 'GET') return json(emails.get(params.get('email')) || {});
        if (url.pathname === '/reviewer' && req.method === 'POST') {
          const result = await db.prepare('UPDATE users SET is_reviewer=? WHERE email=?').bind(params.get('enabled') === 'false' ? 0 : 1, params.get('email')).run();
          return json({ changed: result.meta.changes });
        }
        if (url.pathname === '/capacity' && req.method === 'POST') {
          await db.prepare('UPDATE storage_control SET reservations_enabled=?,discrepancy=NULL WHERE id=1').bind(params.get('enabled') === 'false' ? 0 : 1).run();
          return json({ ok: true });
        }
        if (url.pathname === '/archive' && req.method === 'GET') return json(archive.summary());
        if (url.pathname === '/archive/file' && req.method === 'GET') {
          const file = archive.file(params.get('key'));
          if (!file) { res.writeHead(404).end(); return; }
          res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', file.size);
          file.stream.pipe(res); return;
        }
        if (url.pathname === '/archive/fault' && req.method === 'POST') return json(archive.setFault(params.get('mode') || 'none', Number(params.get('count') || 1)));
        if (url.pathname === '/recover' && req.method === 'POST') {
          if (params.get('due') === 'true') await db.batch([
            db.prepare("UPDATE transfer_jobs SET next_attempt_at=0 WHERE lease_until<=unixepoch()"),
            db.prepare('UPDATE outbox SET sent_at=0 WHERE sent_at IS NOT NULL'),
          ]);
          await recover(); return json({ ok: true });
        }
        if (url.pathname === '/state' && req.method === 'GET') {
          const submissions = (await db.prepare('SELECT * FROM submissions ORDER BY created_at DESC').all()).results;
          const uploads = (await db.prepare('SELECT * FROM uploads').all()).results;
          for (const upload of uploads) upload.object_present = !!(await bucket.head(upload.object_key));
          return json({ submissions, uploads, jobs: (await db.prepare('SELECT * FROM transfer_jobs').all()).results, reserved_bytes: (await db.prepare("SELECT COALESCE(SUM(byte_size),0) bytes FROM uploads WHERE status<>'released'").first()).bytes, migrations: (await db.prepare('SELECT name FROM d1_migrations').all()).results });
        }
        // Fixture controls exist only in the isolated test runner, never in dev or deployment.
        if (test && req.method === 'POST' && url.pathname === '/test/expire-session') {
          await db.prepare('UPDATE sessions SET expires_at=0 WHERE user_id=(SELECT id FROM users WHERE email=?)').bind(params.get('email')).run(); return json({ ok: true });
        }
        if (test && req.method === 'POST' && url.pathname === '/test/expire-upload') {
          await db.prepare("UPDATE uploads SET expires_at=0,lease_until=0 WHERE id=? AND phase<>'bound'").bind(params.get('id')).run(); return json({ ok: true });
        }
        if (test && req.method === 'POST' && url.pathname === '/test/redeliver') {
          const job = await db.prepare('SELECT id,generation,step FROM transfer_jobs WHERE submission_id=?').bind(params.get('id')).first();
          if (!job) { res.writeHead(404).end(); return; }
          const bindings = await mf.getBindings();
          await bindings.PUBLICATION_QUEUE.send({ job_id: job.id, generation: job.generation, step: job.step });
          return json({ ok: true });
        }
        res.writeHead(404).end();
      })().catch((error) => { console.error('Local control failed:', error.message); if (!res.headersSent) res.writeHead(500); res.end(JSON.stringify({ error: 'local_control_failed' })); });
    });
    await new Promise((done, reject) => { server.once('error', reject); server.listen(controlPort, 'localhost', done); });
    interval = setInterval(() => { void recover().catch((error) => console.error(error.message)); }, 5 * 60 * 1000);
    if (watchFiles) {
      const changed = () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          rebuilding = rebuilding.then(async () => { await compile(); await mf.setOptions(options); console.log('Local app rebuilt. Reload your browser.'); }).catch((error) => console.error('Rebuild failed:', error.message));
        }, 150);
      };
      watchers = ['src', 'public'].map((directory) => watch(directory, { recursive: true }, changed));
    }
    console.log(`Offline app ready: ${origin}\nLocal controls: ${controlOrigin}\nState: ${state}`);
    return { stop, db, bucket, origin, controlOrigin, recover, state };
  } catch (error) { await stop(); throw error; }
}
