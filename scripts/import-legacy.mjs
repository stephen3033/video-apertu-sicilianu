import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  HeadObjectCommand,
  ListPartsCommand,
  ListMultipartUploadsCommand,
} from '@aws-sdk/client-s3';
import { adminDatabase } from './admin-db.mjs';
import { validateConfig } from './deployment-config.mjs';
const now = () => Math.floor(Date.now() / 1000),
  partSize = 16 * 1024 * 1024;
export async function importLegacy(manifest, db, storage, prefix) {
  const query = (sql, ...args) => db.prepare(sql).bind(...args);
  // Idempotency preserves existing data and refuses conflicting IDs/emails.
  for (const user of manifest.users) {
    await query(
      'INSERT INTO users(id,email,email_verified_at,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING',
      user.id,
      user.email,
      user.email_verified_at,
      user.created_at,
    ).run();
    const stored = await query(
      'SELECT id,email,email_verified_at,created_at FROM users WHERE id=?',
      user.id,
    ).first();
    if (
      ['id', 'email', 'email_verified_at', 'created_at'].some(
        (field) => stored[field] !== user[field],
      )
    )
      throw new Error('Imported account mismatch');
  }
  for (const s of manifest.submissions) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(s.source_path)) hash.update(chunk);
    if (hash.digest('hex') !== s.sha256 || (await stat(s.source_path)).size !== s.byte_size)
      throw new Error('Source media changed since export');
    if (s.byte_size <= 0 || s.byte_size > 1073741824)
      throw new Error('Source file exceeds staging limit');
    const idempotency = `legacy-${s.id}`,
      id = randomUUID(),
      key = `staging/${id}${s.original_filename.slice(s.original_filename.lastIndexOf('.')).toLowerCase()}`;
    await query(
      `INSERT INTO uploads(id,user_id,object_key,original_filename,content_type,media_kind,byte_size,status,created_at,expires_at,cleanup_after,idempotency_key,phase)
      SELECT ?,?,?,?,?,?,?,'reserved',?,?,?,?,'initializing' WHERE EXISTS(SELECT 1 FROM storage_control WHERE id=1 AND reservations_enabled=1)
      AND COALESCE((SELECT SUM(byte_size) FROM uploads WHERE status<>'released'),0)+?<=10000000000 ON CONFLICT(user_id,idempotency_key) DO NOTHING`,
      id,
      s.user_id,
      key,
      s.original_filename,
      s.content_type,
      s.media_kind,
      s.byte_size,
      now(),
      now() + 86400,
      now() + 86400,
      idempotency,
      s.byte_size,
    ).run();
    let upload = await query(
      'SELECT * FROM uploads WHERE user_id=? AND idempotency_key=?',
      s.user_id,
      idempotency,
    ).first();
    if (!upload) throw new Error('Staging capacity unavailable');
    if (upload.phase === 'released' || (upload.expires_at <= now() && upload.phase !== 'bound'))
      throw new Error('Import reservation expired; reconcile before retry');
    if (!upload.multipart_id) {
      // Recover an acknowledged or ambiguous multipart creation by immutable key.
      const multipart = await storage.start(upload);
      await query(
        "UPDATE uploads SET multipart_id=?,phase='uploading' WHERE id=? AND phase='initializing'",
        multipart,
        upload.id,
      ).run();
      upload.multipart_id = multipart;
    }
    let object = await storage.head(upload);
    if (!object) {
      const parts = await storage.parts(upload);
      for (let offset = 0, n = 1; offset < s.byte_size; offset += partSize, n++) {
        const size = Math.min(partSize, s.byte_size - offset);
        if (parts.some((p) => p.PartNumber === n && p.Size === size)) continue;
        await storage.part(upload, n, s.source_path, offset, size);
      }
      const stored = await storage.parts(upload);
      if (
        stored.length !== Math.ceil(s.byte_size / partSize) ||
        stored.some(
          (p, i) =>
            p.PartNumber !== i + 1 || p.Size !== Math.min(partSize, s.byte_size - i * partSize),
        )
      )
        throw new Error('Imported multipart lengths differ');
      await storage.complete(upload, stored);
      object = await storage.head(upload);
    }
    if (
      !object ||
      object.size !== s.byte_size ||
      object.upload_id !== upload.id ||
      object.content_type !== s.content_type
    )
      throw new Error('Imported object mismatch');
    await db.batch([
      query(
        "UPDATE uploads SET phase='complete',status='staged',etag=? WHERE id=? AND phase IN ('initializing','uploading','complete')",
        object.etag,
        upload.id,
      ),
      query(
        `INSERT INTO submissions(id,user_id,title,notes,original_filename,media_kind,content_type,byte_size,storage_ref,created_at,status,upload_id,r2_etag,ia_item,lifecycle)
      SELECT ?,user_id,?,?,original_filename,media_kind,content_type,byte_size,object_key,?,'staged',id,etag,?,'pending' FROM uploads WHERE id=? AND phase IN ('complete','bound') ON CONFLICT(id) DO NOTHING`,
        s.id,
        s.title,
        s.notes,
        s.created_at,
        `${prefix}-${s.id}`,
        upload.id,
      ),
      query(
        "UPDATE uploads SET phase='bound' WHERE id=? AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND upload_id=?)",
        upload.id,
        s.id,
        upload.id,
      ),
    ]);
    const imported = await query('SELECT * FROM submissions WHERE id=?', s.id).first();
    for (const field of [
      'id',
      'user_id',
      'title',
      'notes',
      'original_filename',
      'media_kind',
      'content_type',
      'byte_size',
      'created_at',
    ])
      if (imported[field] !== s[field]) throw new Error('Imported submission mismatch');
    if (imported.storage_ref !== upload.object_key || imported.r2_etag !== object.etag)
      throw new Error('Imported storage reference mismatch');
  }
  await query(
    'INSERT INTO migration_imports(source_id,imported_at,account_count,submission_count) VALUES(?,?,?,?) ON CONFLICT(source_id) DO NOTHING',
    manifest.source_id,
    new Date().toISOString(),
    manifest.users.length,
    manifest.submissions.length,
  ).run();
  return { accounts: manifest.users.length, submissions: manifest.submissions.length };
}
export function remoteStorage(config) {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.account_id}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  const Bucket = config.r2_buckets[0].bucket_name;
  const target = (u) => ({ Bucket, Key: u.object_key, UploadId: u.multipart_id });
  return {
    async start(u) {
      const existing = await client.send(
        new ListMultipartUploadsCommand({ Bucket, Prefix: u.object_key }),
      );
      if (existing.IsTruncated) throw new Error('Incomplete multipart inventory');
      const found = existing.Uploads?.find((x) => x.Key === u.object_key);
      if (found) return found.UploadId;
      return (
        await client.send(
          new CreateMultipartUploadCommand({
            Bucket,
            Key: u.object_key,
            ContentType: u.content_type,
            Metadata: { upload_id: u.id },
          }),
        )
      ).UploadId;
    },
    async head(u) {
      try {
        const h = await client.send(new HeadObjectCommand({ Bucket, Key: u.object_key }));
        return {
          size: h.ContentLength,
          etag: h.ETag.replace(/^"|"$/g, ''),
          upload_id: h.Metadata?.upload_id,
          content_type: h.ContentType,
        };
      } catch (e) {
        if (e.$metadata?.httpStatusCode === 404) return null;
        throw new Error('R2 HEAD failed');
      }
    },
    async parts(u) {
      const result = await client.send(new ListPartsCommand(target(u)));
      if (result.IsTruncated) throw new Error('Too many parts');
      return result.Parts || [];
    },
    async part(u, n, path, offset, size) {
      await client.send(
        new UploadPartCommand({
          ...target(u),
          PartNumber: n,
          ContentLength: size,
          Body: createReadStream(path, { start: offset, end: offset + size - 1 }),
        }),
      );
    },
    async complete(u, parts) {
      await client.send(
        new CompleteMultipartUploadCommand({
          ...target(u),
          MultipartUpload: {
            Parts: parts.map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })),
          },
        }),
      );
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [environment, file] = process.argv.slice(2);
  if (!['preview', 'production'].includes(environment) || !file)
    throw new Error(
      'Run under op run: node scripts/import-legacy.mjs preview|production manifest.json',
    );
  const config = validateConfig(JSON.parse(await readFile(`wrangler.${environment}.json`, 'utf8')));
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  console.log(
    JSON.stringify(
      await importLegacy(
        manifest,
        adminDatabase(config),
        remoteStorage(config),
        config.vars.IA_ITEM_PREFIX,
      ),
    ),
  );
}
