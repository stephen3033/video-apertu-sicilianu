import { currentLanguage, updateProgress } from './ui';
import { showRequestError } from './errors';
interface AuthorizedPart { url: string; headers: Record<string, string> }
interface Authorization { upload_id: string; part_size: number; phase: string }
class UploadError extends Error { constructor(message: string, public localized = false) { super(message); } }
  async function uploadJSON<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'HX-Request': 'true' },
      body: JSON.stringify({ ...payload, locale: currentLanguage() }),
    });
    if (response.headers.get('HX-Redirect')) {
      window.location.assign(response.headers.get('HX-Redirect')!);
      throw new Error('Session expired');
    }
    const result = await response.json();
    if (!response.ok) {
      throw new UploadError(result.message || 'Upload failed', !!result.message);
    }
    return result;
  }

  function uploadPart(part: AuthorizedPart, blob: Blob, progress: (bytes: number) => void) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', part.url);
      Object.entries(part.headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
      xhr.upload.onprogress = (event) => progress(event.loaded);
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Part upload failed'));
      xhr.onerror = () => reject(new Error('Part upload failed'));
      xhr.ontimeout = () => reject(new Error('Part upload timed out'));
      xhr.timeout = 600000;
      xhr.send(blob);
    });
  }

  // Stop HTMX before it serializes the file. After direct upload, issue the same
  // form request with metadata only; HTMX still performs the existing outerHTML swap.
  document.addEventListener(
    'submit',
    async (event) => {
      const form = event.target instanceof Element ? event.target.closest<HTMLFormElement>('[data-upload-form]') : null;
      if (!form) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (form.dataset.uploading || !form.reportValidity()) return;
      form.dataset.uploading = 'true';
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      button.disabled = true;
      let finalized = false;
      try {
        const input = form.querySelector<HTMLInputElement>('[data-file-input]')!;
        const file = input.files![0];
        const csrf_token = (form.elements.namedItem('csrf_token') as HTMLInputElement).value;
        const title = (form.elements.namedItem('title') as HTMLInputElement).value;
        const notes = (form.elements.namedItem('notes') as HTMLInputElement).value;
        const identity = `${file.name}:${file.size}:${file.lastModified}`;
        if (form.dataset.fileIdentity !== identity) {
          form.dataset.fileIdentity = identity;
          form.dataset.idempotencyKey = crypto.randomUUID();
          delete form.dataset.uploadId;
        }
        updateProgress(form, 0);
        const authorization = await uploadJSON<Authorization>('/uploads/authorize', {
          csrf_token,
          title,
          notes,
          filename: file.name,
          content_type: file.type,
          byte_size: file.size,
          idempotency_key: form.dataset.idempotencyKey,
        });
        const id = authorization.upload_id;
        form.dataset.uploadId = id;
        if (authorization.phase === 'uploading') {
          const count = Math.ceil(file.size / authorization.part_size);
          const loaded = Array(count).fill(0);
          let next = 1;
          let failed = false;
          const runner = async () => {
            while (!failed && next <= count) {
              const n = next++;
              const offset = (n - 1) * authorization.part_size;
              let succeeded = false;
              for (let attempt = 0; attempt < 3 && !succeeded; attempt++) {
                try {
                  const { parts } = await uploadJSON<{ parts: AuthorizedPart[] }>(`/uploads/${id}/parts`, {
                    csrf_token,
                    parts: [n],
                  });
                  await uploadPart(
                    parts[0],
                    file.slice(offset, Math.min(file.size, offset + authorization.part_size)),
                    (bytes) => {
                      loaded[n - 1] = bytes;
                      updateProgress(form, (loaded.reduce((a, b) => a + b, 0) / file.size) * 100);
                    },
                  );
                  succeeded = true;
                } catch (error) {
                  if (attempt === 2) {
                    failed = true;
                    throw error;
                  }
                }
              }
            }
          };
          const results = await Promise.allSettled([runner(), runner()]);
          const failure = results.find((r) => r.status === 'rejected');
          if (failure) throw failure.reason;
          await uploadJSON(`/uploads/${id}/complete`, { csrf_token });
        }
        if (authorization.phase === 'completing')
          await uploadJSON(`/uploads/${id}/complete`, { csrf_token });
        // HTMX's programmatic request has no source form, so the binary input cannot
        // enter the application request, even when hx-encoding remains on the form.
        await htmx.ajax('post', form.action, {
          target: '#submission-workspace',
          swap: 'outerHTML',
          values: { csrf_token, title, notes, upload_id: id },
        });
        finalized = !!document.querySelector('.success-card');
      } catch (error) {
        const lang = currentLanguage();
        const fallback = form.dataset[`uploadError${lang[0].toUpperCase()}${lang.slice(1)}`] || 'Upload failed';
        showRequestError(form, error instanceof UploadError && error.localized ? error.message : fallback);
      } finally {
        delete form.dataset.uploading;
        button.disabled = false;
        if (finalized) updateProgress(form, 100);
      }
    },
    true,
  );
