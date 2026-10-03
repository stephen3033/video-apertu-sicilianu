// Isolated local test harness: no real credentials, source DB, email or Archive writes.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const wrangler = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
await build({
  entryPoints: ['src/entrypoints/worker.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['browser', 'module', 'main'],
  conditions: ['workerd', 'worker', 'browser'],
  external: ['node:*', 'cloudflare:*'],
  outfile: 'dist/browser-worker/index.mjs',
});
const emails = new Map();
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    scriptPath: 'dist/browser-worker/index.mjs',
    compatibilityDate: '2026-08-01',
    compatibilityFlags: ['nodejs_compat'],
    port: 8787,
    host: 'localhost',
    d1Databases: ['DB'],
    r2Buckets: ['STAGING_BUCKET'],
    queueProducers: { PUBLICATION_QUEUE: 'local-publication' },
    bindings: {
      ...wrangler.vars,
      AUTH_CODE_SECRET: 'browser-tests-only-secret',
      EMAIL_BACKEND: 'test',
    },
    serviceBindings: {
      TEST_EMAIL: async (request) => {
        const value = await request.json();
        emails.set(value.to, value);
        return new Response(null);
      },
      ASSETS: async (request) => {
        const path = new URL(request.url).pathname;
        if (!/^\/(static|vendor\/htmx)\/[a-zA-Z0-9/._ -]+$/.test(path) || path.includes('..'))
          return new Response(null, { status: 404 });
        try {
          return new Response(await readFile(`dist/public${path}`), {
            headers: {
              'Content-Type': path.endsWith('.js')
                ? 'text/javascript'
                : path.endsWith('.css')
                  ? 'text/css'
                  : 'image/png',
            },
          });
        } catch {
          return new Response(null, { status: 404 });
        }
      },
    },
    outboundService: async (request) => {
      if (new URL(request.url).hostname.endsWith('archive.org')) {
        const hash = createHash('md5');
        for await (const chunk of request.body || []) hash.update(chunk);
        return new Response('', { headers: { ETag: `"${hash.digest('hex')}"` } });
      }
      throw new Error('Unexpected external network request in browser tests');
    },
  }),
);
const db = await mf.getD1Database('DB');
for (const migration of await readD1Migrations('migrations/d1'))
  await db.batch(migration.queries.map((q) => db.prepare(q)));
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8788');
  if (url.pathname.startsWith('/__local/uploads/')) {
    const upstream = http.request(
      {
        hostname: 'localhost',
        port: 8787,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: 'localhost:8787' },
      },
      (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      },
    );
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
    return;
  }
  if (url.pathname === '/email') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(emails.get(url.searchParams.get('email')) || {}));
    return;
  }
  if (url.pathname === '/reviewer' && req.method === 'POST') {
    await db
      .prepare('UPDATE users SET is_reviewer=1 WHERE email=?')
      .bind(url.searchParams.get('email'))
      .run();
    res.end('ok');
    return;
  }
  if (url.pathname === '/capacity' && req.method === 'POST') {
    await db
      .prepare('UPDATE storage_control SET reservations_enabled=?')
      .bind(url.searchParams.get('enabled') === 'true' ? 1 : 0)
      .run();
    res.end('ok');
    return;
  }
  if (url.pathname === '/health') {
    res.end('ok');
    return;
  }
  res.writeHead(404).end();
});
server.listen(8788, 'localhost');
await mf.ready;
console.log('Browser harness ready on localhost:8787 and localhost:8788');
process.on('SIGTERM', async () => {
  server.close();
  await mf.dispose();
  process.exit(0);
});
