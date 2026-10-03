import {
  S3Client,
  UploadPartCommand,
  ListPartsCommand,
  ListMultipartUploadsCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { type Env } from '../../runtime/bindings';
import { type Upload } from '../../domain/models';
import { now } from '../../utils/time';
import { sql } from '../database/query';
import { UPLOAD_PART } from '../../domain/limits';
import { hmac } from '../../utils/crypto';
export function s3(env: Env) {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}
export function partSize(upload: Upload, n: number) {
  if (!Number.isInteger(n) || n < 1 || n > Math.ceil(upload.byte_size / UPLOAD_PART))
    throw new Error('part_number');
  return Math.min(UPLOAD_PART, upload.byte_size - (n - 1) * UPLOAD_PART);
}
export async function partUrl(env: Env, upload: Upload, n: number) {
  const size = partSize(upload, n);
  if (env.APP_ENV === 'local' && env.LOCAL_UPLOAD_ORIGIN) {
    const expiry = Math.min(now() + 900, upload.expires_at);
    const signature = await hmac(env.AUTH_CODE_SECRET, `${upload.id}:${n}:${size}:${expiry}`);
    return {
      part_number: n,
      byte_size: size,
      url: `${env.LOCAL_UPLOAD_ORIGIN}/__local/uploads/${upload.id}/${n}?size=${size}&expiry=${expiry}&signature=${signature}`,
      headers: { 'Content-Type': upload.content_type },
    };
  }
  const url = await getSignedUrl(
    s3(env),
    new UploadPartCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: upload.object_key,
      UploadId: upload.multipart_id!,
      PartNumber: n,
      ContentLength: size,
    }),
    {
      expiresIn: Math.min(900, upload.expires_at - now()),
      signableHeaders: new Set(['content-length']),
    },
  );
  return { part_number: n, byte_size: size, url, headers: { 'Content-Type': upload.content_type } };
}
export async function listParts(
  env: Env,
  upload: Upload,
): Promise<{ partNumber: number; etag: string; size: number }[]> {
  if (env.APP_ENV === 'local' && env.LOCAL_UPLOAD_ORIGIN) {
    const result = await sql(
      env,
      'SELECT part_number,etag,byte_size FROM upload_parts WHERE upload_id=? ORDER BY part_number',
      upload.id,
    ).all<{ part_number: number; etag: string; byte_size: number }>();
    return result.results.map((p) => ({
      partNumber: p.part_number,
      etag: p.etag,
      size: p.byte_size,
    }));
  }
  const result = await s3(env).send(
    new ListPartsCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: upload.object_key,
      UploadId: upload.multipart_id!,
    }),
  );
  if (result.IsTruncated) throw new Error('too_many_parts');
  return (result.Parts || []).map((p) => ({
    partNumber: p.PartNumber!,
    etag: p.ETag!.replace(/^"|"$/g, ''),
    size: p.Size!,
  }));
}
export async function verifyObject(env: Env, upload: Upload) {
  const object = await env.STAGING_BUCKET.head(upload.object_key);
  if (
    !object ||
    object.size !== upload.byte_size ||
    object.customMetadata?.upload_id !== upload.id ||
    object.httpMetadata?.contentType !== upload.content_type
  )
    throw new Error('object_mismatch');
  return object;
}
export async function cleanupUpload(env: Env, upload: Upload) {
  if (upload.phase !== 'cleanup') return;
  if (upload.multipart_id) {
    // Abort is idempotent in the R2 binding, including already-completed uploads.
    await env.STAGING_BUCKET.resumeMultipartUpload(upload.object_key, upload.multipart_id).abort();
  } else if (env.APP_ENV !== 'local') {
    // Recover a crash between multipart creation and storing its identifier.
    const client = s3(env);
    const result = await client.send(
      new ListMultipartUploadsCommand({ Bucket: env.R2_BUCKET_NAME, Prefix: upload.object_key }),
    );
    if (result.IsTruncated) throw new Error('multipart_inventory_incomplete');
    for (const entry of result.Uploads || [])
      if (entry.Key === upload.object_key)
        await client.send(
          new AbortMultipartUploadCommand({
            Bucket: env.R2_BUCKET_NAME,
            Key: entry.Key,
            UploadId: entry.UploadId,
          }),
        );
  }
  await env.STAGING_BUCKET.delete(upload.object_key);
  if (await env.STAGING_BUCKET.head(upload.object_key)) throw new Error('deletion_unconfirmed');
  await sql(
    env,
    `UPDATE uploads SET status='released',phase='released',lease_token=NULL,lease_until=0 WHERE id=? AND phase='cleanup'`,
    upload.id,
  ).run();
}

export async function* multipartInventory(env: Env) {
  let keyMarker: string | undefined, uploadMarker: string | undefined;
  do {
    const response = await s3(env).send(
      new ListMultipartUploadsCommand({
        Bucket: env.R2_BUCKET_NAME,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadMarker,
      }),
    );
    for (const upload of response.Uploads || []) yield upload;
    keyMarker = response.IsTruncated ? response.NextKeyMarker : undefined;
    uploadMarker = response.IsTruncated ? response.NextUploadIdMarker : undefined;
    if (response.IsTruncated && !keyMarker) throw new Error('multipart_inventory_incomplete');
  } while (keyMarker);
}
