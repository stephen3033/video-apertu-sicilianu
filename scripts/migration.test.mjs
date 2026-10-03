import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { importLegacy } from './import-legacy.mjs';
test('legacy account and media import preserves identity and ownership on rerun', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vas-import-test-'));
  const path = join(directory, 'sample.mp3');
  await writeFile(path, 'voice');
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      compatibilityDate: '2026-08-01',
      d1Databases: ['DB'],
      r2Buckets: ['STAGING_BUCKET'],
    }),
  );
  try {
    const db = await mf.getD1Database('DB'),
      bucket = await mf.getR2Bucket('STAGING_BUCKET');
    for (const migration of await readD1Migrations('migrations/d1'))
      await db.batch(migration.queries.map((q) => db.prepare(q)));
    const parts = new Map();
    const storage = {
      async start(u) {
        return (
          await bucket.createMultipartUpload(u.object_key, {
            httpMetadata: { contentType: u.content_type },
            customMetadata: { upload_id: u.id },
          })
        ).uploadId;
      },
      async head(u) {
        const h = await bucket.head(u.object_key);
        return h
          ? {
              size: h.size,
              etag: h.etag,
              upload_id: h.customMetadata.upload_id,
              content_type: h.httpMetadata.contentType,
            }
          : null;
      },
      async parts(u) {
        return parts.get(u.id) || [];
      },
      async part(u, n, file) {
        const data = await readFile(file);
        const p = await bucket
          .resumeMultipartUpload(u.object_key, u.multipart_id)
          .uploadPart(n, data);
        parts.set(u.id, [{ PartNumber: n, Size: data.length, ETag: p.etag }]);
      },
      async complete(u, rows) {
        await bucket
          .resumeMultipartUpload(u.object_key, u.multipart_id)
          .complete(rows.map((p) => ({ partNumber: p.PartNumber, etag: p.ETag })));
      },
    };
    const account = {
      id: 'original-account',
      email: 'original@example.com',
      email_verified_at: '2026-01-01 00:00:00',
      created_at: '2025-12-31 00:00:00',
    };
    const submission = {
      id: 'original-submission',
      user_id: account.id,
      title: 'Original title',
      notes: 'Original notes',
      original_filename: 'sample.mp3',
      media_kind: 'audio',
      content_type: 'audio/mpeg',
      byte_size: 5,
      storage_ref: 'old/local/path.mp3',
      created_at: '2026-01-02 00:00:00',
      source_path: path,
      sha256: createHash('sha256').update('voice').digest('hex'),
    };
    const manifest = { source_id: 'fixture', users: [account], submissions: [submission] };
    await importLegacy(manifest, db, storage, 'vas-preview');
    await importLegacy(manifest, db, storage, 'vas-preview');
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM users').first()).n, 1);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM uploads').first()).n, 1);
    const row = await db.prepare('SELECT * FROM submissions').first();
    assert.equal(row.id, submission.id);
    assert.equal(row.user_id, account.id);
    assert.equal(row.created_at, submission.created_at);
    assert.equal(row.lifecycle, 'pending');
    assert.equal(row.review_decision, 'pending');
    assert.equal((await db.prepare('SELECT is_reviewer FROM users').first()).is_reviewer, 0);
    assert.equal((await db.prepare('SELECT phase FROM uploads').first()).phase, 'bound');
    for (const table of ['sessions', 'login_challenges'])
      assert.equal((await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n, 0);
    await writeFile(path, 'changed');
    await assert.rejects(
      importLegacy(manifest, db, storage, 'vas-preview'),
      /changed since export/,
    );
  } finally {
    await mf.dispose();
  }
});
