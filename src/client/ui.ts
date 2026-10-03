  const STORAGE_KEY = 'vas-language';
  type Locale = 'en' | 'scn' | 'it';
  const SUPPORTED = new Set(['en', 'scn', 'it']);
  const DATE_LOCALES = { en: 'en-GB', scn: 'scn', it: 'it-IT' };

  export function currentLanguage(): Locale {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved && SUPPORTED.has(saved) ? saved as Locale : 'en';
  }

  export function translate(root: ParentNode = document) {
    const language = currentLanguage();
    document.documentElement.lang = language;

    root.querySelectorAll<HTMLElement>(`[data-i18n-${language}]`).forEach((element) => {
      const value = element.dataset[`i18n${language[0].toUpperCase()}${language.slice(1)}`];
      if (value !== undefined) element.textContent = value;
    });

    root.querySelectorAll<HTMLElement>('[data-i18n-attribute]').forEach((element) => {
      const attribute = element.dataset.i18nAttribute;
      const key = `i18nAttr${language[0].toUpperCase()}${language.slice(1)}`;
      const value = element.dataset[key];
      if (attribute && value !== undefined) element.setAttribute(attribute, value);
    });

    document.querySelectorAll<HTMLSelectElement>('[data-language-select]').forEach((select) => {
      select.value = language;
    });
    document.querySelectorAll<HTMLInputElement>('[data-auth-locale]').forEach((input) => {
      input.value = language;
    });

    document.querySelectorAll<HTMLInputElement>('[data-file-input]').forEach(validateFileSize);
    document.querySelectorAll<HTMLTimeElement>('[data-local-date]').forEach((element) => {
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

    const page = document.querySelector<HTMLElement>('[data-page-title-en]');
    if (page) {
      const title = page.dataset[`pageTitle${language[0].toUpperCase()}${language.slice(1)}`];
      if (title) document.title = `${title} · Video Apertu Sicilianu`;
    } else {
      document.title = 'Video Apertu Sicilianu';
    }
  }

  function setLanguage(language: string) {
    if (!SUPPORTED.has(language)) return;
    window.localStorage.setItem(STORAGE_KEY, language);
    translate(document);
  }

  export function syncNavigation() {
    const section = document.querySelector<HTMLElement>('#app-content [data-section]')?.dataset.section;
    document.querySelectorAll<HTMLElement>('[data-nav-section]').forEach((link) => {
      const active = link.dataset.navSection === section;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function validateFileSize(input: HTMLInputElement) {
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

  function showSelectedFile(input: HTMLInputElement) {
    const dropzone = input.closest('[data-dropzone]');
    const selected = dropzone?.querySelector<HTMLElement>('[data-selected-file]');
    const filename = dropzone?.querySelector<HTMLElement>('[data-filename]');
    const file = input.files?.[0];
    if (selected && filename) {
      selected.hidden = !file;
      filename.textContent = file?.name || '';
    }
    validateFileSize(input);
  }

  export function updateProgress(form: HTMLFormElement, percent: number) {
    const status = form.querySelector<HTMLElement>('[data-upload-status]');
    const progress = status?.querySelector<HTMLProgressElement>('progress');
    const label = status?.querySelector<HTMLElement>('[data-progress-value]');
    if (!status || !progress || !label) return;
    status.hidden = false;
    progress.value = percent;
    label.textContent = `${Math.round(percent)}%`;
  }

  document.addEventListener('change', (event) => {
    if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) return;
    if (event.target.matches('[data-language-select]')) {
      setLanguage(event.target.value);
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-file-input]')) {
      showSelectedFile(event.target);
    }
  });

  document.addEventListener('dragover', (event) => {
    if (!(event.target instanceof Element)) return;
    const dropzone = event.target.closest('[data-dropzone]');
    if (!dropzone) return;
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  });

  document.addEventListener('dragleave', (event) => {
    if (!(event.target instanceof Element)) return;
    event.target.closest('[data-dropzone]')?.classList.remove('is-dragging');
  });

  document.addEventListener('drop', (event) => {
    if (!(event.target instanceof Element)) return;
    const dropzone = event.target.closest('[data-dropzone]');
    if (!dropzone) return;
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
    const input = dropzone.querySelector<HTMLInputElement>('[data-file-input]');
    if (input && event.dataTransfer?.files.length) {
      input.files = event.dataTransfer.files;
      showSelectedFile(input);
    }
  });

