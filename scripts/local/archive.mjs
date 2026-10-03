// Offline IAS3 simulator. All media is streamed to disk; no request reaches the internet.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const xmlEscape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const xml = (value, status = 200) => new Response(value, { status, headers: { 'Content-Type': 'application/xml' } });
const tag = (source, name) => source.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];

export async function createArchive(directory) {
  await mkdir(directory, { recursive: true });
  const index = join(directory, 'index.json');
  let state;
  try { state = JSON.parse(await readFile(index, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = { objects: {}, uploads: {}, writes: 0 }; }
  let saving = Promise.resolve();
  let fault = { mode: 'none', remaining: 0 };
  const save = () => {
    saving = saving.then(async () => {
      const temporary = `${index}.tmp`;
      await writeFile(temporary, JSON.stringify(state));
      await rename(temporary, index);
    });
    return saving;
  };
  async function store(body, name) {
    const path = join(directory, name);
    const temporary = `${path}.${randomUUID()}.part`;
    const md5 = createHash('md5'), sha256 = createHash('sha256');
    let size = 0;
    try {
      await pipeline(Readable.from((async function* () {
        for await (const chunk of body || []) {
          md5.update(chunk); sha256.update(chunk); size += chunk.length;
          yield chunk;
        }
      })()), createWriteStream(temporary));
      await rename(temporary, path);
    } catch (error) { await rm(temporary, { force: true }); throw error; }
    return { file: name, size, etag: md5.digest('hex'), sha256: sha256.digest('hex') };
  }
  const summary = () => ({
    objects: Object.entries(state.objects).map(([key, object]) => ({ key, ...object })),
    uploads: Object.entries(state.uploads).map(([id, upload]) => ({ id, ...upload })),
    writes: state.writes,
    fault,
  });
  return {
    summary,
    setFault(mode = 'none', remaining = 1) {
      if (!['none', 'throttle', 'lost-ack'].includes(mode) || !Number.isSafeInteger(remaining) || remaining < 0) throw new Error('Invalid fault');
      fault = { mode, remaining };
      return fault;
    },
    file(key) { const object = state.objects[key]; return object ? { ...object, stream: createReadStream(join(directory, object.file)) } : null; },
    async fetch(request) {
      const url = new URL(request.url);
      if (url.protocol !== 'https:' || url.hostname !== 's3.us.archive.org') throw new Error('Offline runtime blocked external request');
      const key = url.pathname.slice(1), method = request.method;
      const changing = ['PUT', 'POST'].includes(method);
      const mode = changing && fault.remaining > 0 ? fault.mode : 'none';
      if (mode !== 'none') fault.remaining--;
      if (mode === 'throttle') { await request.body?.cancel(); return xml('<Error><Code>SlowDown</Code></Error>', 429); }
      if (method === 'HEAD') {
        const object = state.objects[key];
        return new Response(null, { status: object ? 200 : 404, headers: object ? { ETag: `"${object.etag}"`, 'Content-Length': String(object.size) } : {} });
      }
      if (method === 'GET' && url.searchParams.has('uploads')) {
        const prefix = url.searchParams.get('prefix') || '';
        const entries = Object.entries(state.uploads).filter(([, u]) => !u.completed && u.key.startsWith(`${key}/`) && decodeURIComponent(u.key.slice(key.length + 1)).startsWith(prefix));
        return xml(`<ListMultipartUploadsResult><IsTruncated>false</IsTruncated>${entries.map(([id, u]) => `<Upload><Key>${xmlEscape(decodeURIComponent(u.key.slice(key.length + 1)))}</Key><UploadId>${id}</UploadId></Upload>`).join('')}</ListMultipartUploadsResult>`);
      }
      if (method === 'POST' && url.searchParams.has('uploads')) {
        const id = randomUUID();
        state.uploads[id] = { key, parts: {}, metadata: Object.fromEntries([...request.headers].filter(([name]) => name.startsWith('x-archive-meta'))) };
        await save();
        return xml(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
      }
      const uploadId = url.searchParams.get('uploadId');
      const upload = state.uploads[uploadId];
      if (method === 'PUT') {
        const part = Number(url.searchParams.get('partNumber'));
        if (uploadId && (!upload || upload.key !== key || upload.completed || !Number.isInteger(part) || part < 1)) return xml('<Error><Code>NoSuchUpload</Code></Error>', 404);
        const name = createHash('sha256').update(uploadId ? `${key}:${uploadId}:${part}` : key).digest('hex');
        const object = await store(request.body, name);
        if (Number(request.headers.get('Content-Length')) !== object.size) throw new Error('Archive content length mismatch');
        state.writes++;
        if (uploadId) upload.parts[part] = object;
        else state.objects[key] = { ...object, metadata: Object.fromEntries([...request.headers].filter(([name]) => name.startsWith('x-archive-meta'))) };
        await save();
        if (mode === 'lost-ack') throw new Error('Simulated lost upload acknowledgement');
        return new Response('', { headers: { ETag: `"${object.etag}"` } });
      }
      if (method === 'POST' && upload && upload.key === key && !upload.completed) {
        const manifest = await request.text();
        const parts = [...manifest.matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map((match) => ({ n: Number(tag(match[1], 'PartNumber')), etag: tag(match[1], 'ETag')?.replace(/^"|"$/g, '') }));
        if (!parts.length || parts.some((p, i) => p.n !== i + 1 || upload.parts[p.n]?.etag !== p.etag)) return xml('<Error><Code>InvalidPart</Code></Error>', 400);
        const object = await store((async function* () {
          for (const part of parts) yield* createReadStream(join(directory, upload.parts[part.n].file));
        })(), createHash('sha256').update(key).digest('hex'));
        object.etag = `${createHash('md5').update(Buffer.from(parts.map((p) => p.etag).join(''), 'hex')).digest('hex')}-${parts.length}`;
        state.objects[key] = { ...object, metadata: upload.metadata };
        upload.completed = true;
        await save();
        for (const part of parts) await rm(join(directory, upload.parts[part.n].file), { force: true });
        if (mode === 'lost-ack') throw new Error('Simulated lost completion acknowledgement');
        return xml(`<CompleteMultipartUploadResult><ETag>"${object.etag}"</ETag></CompleteMultipartUploadResult>`);
      }
      return xml('<Error><Code>NotFound</Code></Error>', 404);
    },
  };
}
