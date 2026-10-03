(() => {
  'use strict';

  const STORAGE_KEY = 'vas-language';
  const SUPPORTED = new Set(['en', 'scn', 'it']);
  const DATE_LOCALES = { en: 'en-GB', scn: 'scn', it: 'it-IT' };

  function currentLanguage() {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return SUPPORTED.has(saved) ? saved : 'en';
  }

  function translate(root = document) {
    const language = currentLanguage();
    document.documentElement.lang = language;

    root.querySelectorAll(`[data-i18n-${language}]`).forEach((element) => {
      const value = element.dataset[`i18n${language[0].toUpperCase()}${language.slice(1)}`];
      if (value !== undefined) element.textContent = value;
    });

    root.querySelectorAll('[data-i18n-attribute]').forEach((element) => {
      const attribute = element.dataset.i18nAttribute;
      const key = `i18nAttr${language[0].toUpperCase()}${language.slice(1)}`;
      const value = element.dataset[key];
      if (attribute && value !== undefined) element.setAttribute(attribute, value);
    });

    document.querySelectorAll('[data-language-select]').forEach((select) => {
      select.value = language;
    });
    document.querySelectorAll('[data-auth-locale]').forEach((input) => {
      input.value = language;
    });

    document.querySelectorAll('[data-file-input]').forEach(validateFileSize);
    document.querySelectorAll('[data-local-date]').forEach((element) => {
      const date = new Date(element.dateTime);
      if (!Number.isNaN(date.valueOf())) {
        try {
          element.textContent = new Intl.DateTimeFormat(DATE_LOCALES[language], {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }).format(date);
        } catch (_error) {
          element.textContent = new Intl.DateTimeFormat('it-IT', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }).format(date);
        }
      }
    });

    const page = document.querySelector('[data-page-title-en]');
    if (page) {
      const title = page.dataset[`pageTitle${language[0].toUpperCase()}${language.slice(1)}`];
      if (title) document.title = `${title} · Video Apertu Sicilianu`;
    } else {
      document.title = 'Video Apertu Sicilianu';
    }
  }

  function setLanguage(language) {
    if (!SUPPORTED.has(language)) return;
    window.localStorage.setItem(STORAGE_KEY, language);
    translate(document);
  }

  function syncNavigation() {
    const section = document.querySelector('#app-content [data-section]')?.dataset.section;
    document.querySelectorAll('[data-nav-section]').forEach((link) => {
      const active = link.dataset.navSection === section;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function validateFileSize(input) {
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    const maxBytes = Number(input.dataset.maxBytes || 0);
    if (file && maxBytes && file.size > maxBytes) {
      const language = currentLanguage();
      const key = `sizeError${language[0].toUpperCase()}${language.slice(1)}`;
      input.setCustomValidity(
        input.dataset[key] || input.dataset.sizeErrorEn || 'File is too large.',
      );
    } else {
      input.setCustomValidity('');
    }
  }

  function showSelectedFile(input) {
    const dropzone = input.closest('[data-dropzone]');
    const selected = dropzone?.querySelector('[data-selected-file]');
    const filename = dropzone?.querySelector('[data-filename]');
    const file = input.files?.[0];
    if (selected && filename) {
      selected.hidden = !file;
      filename.textContent = file?.name || '';
    }
    validateFileSize(input);
  }

  function updateProgress(form, percent) {
    const status = form.querySelector('[data-upload-status]');
    const progress = status?.querySelector('progress');
    const label = status?.querySelector('[data-progress-value]');
    if (!status || !progress || !label) return;
    status.hidden = false;
    progress.value = percent;
    label.textContent = `${Math.round(percent)}%`;
  }

  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-language-select]')) {
      setLanguage(event.target.value);
    }
    if (event.target.matches('[data-file-input]')) {
      showSelectedFile(event.target);
    }
  });

  document.addEventListener('dragover', (event) => {
    const dropzone = event.target.closest('[data-dropzone]');
    if (!dropzone) return;
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  });

  document.addEventListener('dragleave', (event) => {
    event.target.closest('[data-dropzone]')?.classList.remove('is-dragging');
  });

  document.addEventListener('drop', (event) => {
    const dropzone = event.target.closest('[data-dropzone]');
    if (!dropzone) return;
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
    const input = dropzone.querySelector('[data-file-input]');
    if (input && event.dataTransfer.files.length) {
      input.files = event.dataTransfer.files;
      showSelectedFile(input);
    }
  });

  async function uploadJSON(path, payload) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'HX-Request': 'true' },
      body: JSON.stringify({ ...payload, locale: currentLanguage() }),
    });
    if (response.headers.get('HX-Redirect')) {
      window.location.assign(response.headers.get('HX-Redirect'));
      throw new Error('Session expired');
    }
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.message || 'Upload failed');
      error.localized = !!result.message;
      throw error;
    }
    return result;
  }

  function uploadPart(part, blob, progress) {
    return new Promise((resolve, reject) => {
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
      const form = event.target.closest?.('[data-upload-form]');
      if (!form) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (form.dataset.uploading || !form.reportValidity()) return;
      form.dataset.uploading = 'true';
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      let finalized = false;
      try {
        const input = form.querySelector('[data-file-input]');
        const file = input.files[0];
        const csrf_token = form.elements.csrf_token.value;
        const title = form.elements.title.value;
        const notes = form.elements.notes.value;
        const identity = `${file.name}:${file.size}:${file.lastModified}`;
        if (form.dataset.fileIdentity !== identity) {
          form.dataset.fileIdentity = identity;
          form.dataset.idempotencyKey = crypto.randomUUID();
          delete form.dataset.uploadId;
        }
        updateProgress(form, 0);
        const authorization = await uploadJSON('/uploads/authorize', {
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
                  const { parts } = await uploadJSON(`/uploads/${id}/parts`, {
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
        await htmx.ajax('POST', form.action, {
          target: '#submission-workspace',
          swap: 'outerHTML',
          values: { csrf_token, title, notes, upload_id: id },
        });
        finalized = true;
      } catch (error) {
        let alert = form.parentElement.querySelector('[data-upload-error]');
        if (!alert) {
          alert = document.createElement('p');
          alert.className = 'form-errors';
          alert.setAttribute('role', 'alert');
          alert.dataset.uploadError = '';
          form.before(alert);
        }
        const lang = currentLanguage();
        alert.textContent = error.localized
          ? error.message
          : form.dataset[`uploadError${lang[0].toUpperCase()}${lang.slice(1)}`] || error.message;
      } finally {
        delete form.dataset.uploading;
        button.disabled = false;
        if (finalized) updateProgress(form, 100);
      }
    },
    true,
  );

  document.body.addEventListener('htmx:afterSwap', (event) => {
    // An outerHTML swap reports the element that was replaced, so localize the
    // live document instead of relying on that possibly detached target.
    translate(document);
    syncNavigation();
    const focusTarget = event.detail.target?.querySelector?.("h1, h2, [tabindex='-1']");
    if (focusTarget) {
      focusTarget.setAttribute('tabindex', '-1');
      focusTarget.focus({ preventScroll: true });
    }
  });

  document.body.addEventListener('htmx:beforeSwap', (event) => {
    if ([400, 403, 409, 429, 507].includes(event.detail.xhr?.status)) {
      event.detail.shouldSwap = true;
      event.detail.isError = false;
    }
  });

  document.body.addEventListener('htmx:historyRestore', () => {
    translate(document);
    syncNavigation();
  });

  translate(document);
  syncNavigation();
})();
