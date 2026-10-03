import { it, expect } from 'vitest';
import { partUrl, partSize } from '../src/infrastructure/storage/r2';
import { env } from './helpers';
import { type Upload } from '../src/domain/models';
import { now } from '../src/utils/time';
import { UPLOAD_PART } from '../src/domain/limits';
it('signs exact part lengths and expires URLs while rejecting invalid part numbers', async () => {
  const u = {
    id: 'upload',
    object_key: 'staging/upload.mp3',
    byte_size: UPLOAD_PART + 7,
    multipart_id: 'multipart',
    content_type: 'audio/mpeg',
    expires_at: now() + 86400,
  } as Upload;
  const part = await partUrl(
    {
      ...env,
      APP_ENV: 'preview',
      LOCAL_UPLOAD_ORIGIN: undefined,
      R2_ACCOUNT_ID: 'a'.repeat(32),
      R2_ACCESS_KEY_ID: 'test-access',
      R2_SECRET_ACCESS_KEY: 'test-secret',
    },
    u,
    2,
  );
  const url = new URL(part.url);
  expect(url.hostname).toContain('r2.cloudflarestorage.com');
  expect(part.byte_size).toBe(7);
  expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
  expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
  expect(url.searchParams.get('partNumber')).toBe('2');
  for (const n of [0, 3, -1, 1.5]) expect(() => partSize(u, n)).toThrow();
});
