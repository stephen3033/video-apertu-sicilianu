import { createHash } from 'node:crypto';
import { type Env } from '../../runtime/bindings';
import { type Submission } from '../../domain/models';
import { TRANSFER_PART } from '../../domain/limits';
export class ArchiveError extends Error {
  constructor(public category: string) {
    super(category);
  }
}
export const xmlEscape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
export function xmlValue(xml: string, tag: string) {
  const value = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`))?.[1];
  return value
    ?.replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
export const archiveFile = (s: Submission) =>
  `${s.id}${s.original_filename.slice(s.original_filename.lastIndexOf('.')).toLowerCase()}`;
export const archiveURL = (s: Submission) =>
  `https://s3.us.archive.org/${encodeURIComponent(s.ia_item)}/${encodeURIComponent(archiveFile(s))}`;
export function metadata(s: Submission) {
  return {
    'x-archive-auto-make-bucket': '1',
    'x-archive-meta-title': `uri(${encodeURIComponent(s.title)})`,
    'x-archive-meta-description': `uri(${encodeURIComponent(s.notes || '')})`,
    'x-archive-meta-language': 'scn',
    'x-archive-meta-mediatype': s.media_kind === 'audio' ? 'audio' : 'movies',
    'x-archive-meta01-collection':
      s.media_kind === 'audio' ? 'opensource_audio' : 'opensource_movies',
    'x-archive-size-hint': String(s.byte_size),
    'x-archive-meta-vas-submission': s.id,
  };
}
export function trustedArchive(url: URL) {
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    (!url.port || url.port === '443') &&
    (url.hostname === 's3.us.archive.org' ||
      /^s3\.[a-z0-9-]+\.archive\.org$/.test(url.hostname) ||
      /^ia[0-9]+\.(?:us|eu)\.archive\.org$/.test(url.hostname))
  );
}
type BodySource = () => Promise<{ body: ReadableStream; done: Promise<void>; cancel: () => void }>;
// Reopen R2 on redirects. Never forward LOW credentials outside the fixed Archive host allowlist.
export async function archiveRequest(
  env: Env,
  url: string,
  method: string,
  headers: Record<string, string> = {},
  source?: BodySource,
  smallBody?: string,
  deadline = Date.now() + 600000,
) {
  let target = new URL(url);
  const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!trustedArchive(target)) throw new ArchiveError('archive_redirect');
    const stream = source ? await source() : undefined;
    if (stream) signal.addEventListener('abort', stream.cancel, { once: true });
    let response: Response;
    try {
      response = await fetch(target, {
        method,
        headers: { Authorization: `LOW ${env.IA_ACCESS_KEY}:${env.IA_SECRET_KEY}`, ...headers },
        body: stream?.body || smallBody,
        redirect: 'manual',
        signal,
      });
    } catch {
      // A request can fail after the full stream was delivered. The checksum callback
      // may already have persisted the fingerprint for HEAD-based recovery.
      stream?.cancel();
      await stream?.done.catch(() => {});
      throw new ArchiveError('archive_network');
    }
    if ([307, 308].includes(response.status)) {
      const location = response.headers.get('Location');
      await response.body?.cancel();
      // Fetch may abandon an upload body on redirect, causing the pump to reject.
      stream?.cancel();
      await stream?.done.catch(() => {});
      if (!location) throw new ArchiveError('archive_redirect');
      target = new URL(location, target);
      continue;
    }
    if (stream) {
      if (!response.ok) {
        stream.cancel();
        await stream.done.catch(() => {});
      } else await stream.done;
      signal.removeEventListener('abort', stream.cancel);
    }
    return response;
  }
  throw new ArchiveError('archive_redirect');
}
export async function smallXML(response: Response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new ArchiveError(
      response.status === 429 ? 'archive_throttled' : `archive_http_${response.status}`,
    );
  }
  const reader = response.body?.getReader();
  let size = 0;
  let xml = '';
  const decoder = new TextDecoder();
  if (reader)
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new ArchiveError('archive_response_large');
      }
      xml += decoder.decode(value, { stream: true });
    }
  xml += decoder.decode();
  if (/<(?:[\w-]+:)?Error(?:\s|>)/i.test(xml)) throw new ArchiveError('archive_xml_error');
  return xml;
}
export function objectSource(
  env: Env,
  s: Submission,
  offset: number,
  length: number,
  checksum: (md5: string) => Promise<void>,
): BodySource {
  return async () => {
    const object = await env.STAGING_BUCKET.get(s.storage_ref, {
      range: { offset, length },
      onlyIf: { etagMatches: s.r2_etag },
    });
    if (!object || !('body' in object)) throw new ArchiveError('staging_object_changed');
    const hash = createHash('md5');
    const fixed = new FixedLengthStream(length);
    const hashing = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        hash.update(chunk);
        controller.enqueue(chunk);
      },
      async flush() {
        await checksum(hash.digest('hex'));
      },
    });
    const controller = new AbortController();
    const done = object.body
      .pipeThrough(hashing)
      .pipeTo(fixed.writable, { signal: controller.signal });
    // Attach immediately so failed/redirected fetches cannot create unhandled rejections.
    void done.catch(() => {});
    return { body: fixed.readable, done, cancel: () => controller.abort() };
  };
}
export function multipartETag(parts: { etag: string }[]) {
  const bytes = parts.map((p) => p.etag.replace(/^"|"$/g, ''));
  if (bytes.some((s) => !/^[a-f0-9]{32}$/i.test(s))) throw new ArchiveError('archive_part_etag');
  return `${createHash('md5')
    .update(Buffer.from(bytes.join(''), 'hex'))
    .digest('hex')}-${parts.length}`;
}
export async function upstreamMatches(
  env: Env,
  s: Submission,
  expected: string | null,
  deadline?: number,
) {
  if (!expected) return false;
  const response = await archiveRequest(
    env,
    archiveURL(s),
    'HEAD',
    {},
    undefined,
    undefined,
    deadline,
  );
  if (response.status === 404) return false;
  if (!response.ok) throw new ArchiveError('archive_verify_unavailable');
  return (
    Number(response.headers.get('Content-Length')) === s.byte_size &&
    response.headers.get('ETag')?.replace(/^"|"$/g, '') === expected
  );
}
export const transferPartSize = (s: Submission, n: number) =>
  Math.min(TRANSFER_PART, s.byte_size - (n - 1) * TRANSFER_PART);
