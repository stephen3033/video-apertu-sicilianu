import { escape } from '../utils/html';
import { text, errors, translated_attribute } from './helpers';
import { type View } from './types';
import { tr } from '../i18n/messages';
const accept_extensions = '.mp4,.m4v,.mov,.webm,.mkv,.avi,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus';
export function submissionForm(v: View): string {
  return `
<div id="submission-workspace" class="submission-workspace">
  ${errors(v.errors)}
  <form
    class="submission-form"
    method="post"
    enctype="multipart/form-data"
    action="${escape('/submissions')}"
    hx-post="${escape('/submissions')}"
    hx-encoding="multipart/form-data"
    hx-target="#submission-workspace"
    hx-swap="outerHTML"
    hx-disabled-elt="find button"
    data-upload-form
    data-upload-error-en="${escape(tr['error.upload']['en'])}"
    data-upload-error-scn="${escape(tr['error.upload']['scn'])}"
    data-upload-error-it="${escape(tr['error.upload']['it'])}"
  >
    <input type="hidden" name="csrf_token" value="${escape(v.csrf_token)}">
    <div class="form-columns">
      <div class="form-details">
        <label class="field">
          ${text('form.title')}
          <input name="title" type="text" value="${escape(v.form_title)}" required maxlength="160" aria-describedby="title-help">
          ${text('form.title.help', 'small', 'field-help')}
        </label>
        <label class="field">
          <span>${text('form.notes')} <em>— ${text('form.optional')}</em></span>
          <textarea name="notes" rows="6" maxlength="2000" aria-describedby="notes-help">${escape(v.form_notes)}</textarea>
          ${text('form.notes.help', 'small', 'field-help')}
        </label>
      </div>

      <div class="file-column">
        <span class="field-label">${text('form.file')}</span>
        <label class="dropzone" data-dropzone>
          <input
            class="sr-only"
            name="media"
            type="file"
            accept="${escape(accept_extensions)}"
            required
            data-file-input
            data-max-bytes="${escape(1073741824)}"
            data-size-error-en="${escape(tr['error.file_size']['en'])}"
            data-size-error-scn="${escape(tr['error.file_size']['scn'])}"
            data-size-error-it="${escape(tr['error.file_size']['it'])}"
          >
          <span class="dropzone__icon" aria-hidden="true">
            <svg viewBox="0 0 48 48"><path d="M24 33V12m0 0-8 8m8-8 8 8M9 31v5a4 4 0 0 0 4 4h22a4 4 0 0 0 4-4v-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
          ${text('form.drop', 'strong')}
          <span class="selected-file" data-selected-file hidden>
            ${text('form.selected')}: <b data-filename></b>
          </span>
        </label>
        <div class="file-rules">
          ${text('form.formats', 'span')}
          <span>${text('form.limit')}: ${escape('1 GiB')}</span>
        </div>
      </div>
    </div>

    <div class="upload-status" data-upload-status hidden aria-live="polite">
      <div class="upload-status__label">
        ${text('form.uploading')}
        <span data-progress-value>0%</span>
      </div>
      <progress max="100" value="0">
        ${text('form.progress')}
      </progress>
    </div>

    <div class="form-actions">
      <button class="button button--primary" type="submit">
        ${text('form.submit')}
        <span aria-hidden="true">↑</span>
      </button>
    </div>
  </form>
</div>

`;
}
export function history(v: View): string {
  return `
<section
  class="page-panel page-panel--history"
  data-section="history"
  data-page-title-en="${escape(tr['history.title']['en'])}"
  data-page-title-scn="${escape(tr['history.title']['scn'])}"
  data-page-title-it="${escape(tr['history.title']['it'])}"
>
  <div class="page-heading">
    <div>
      ${text('history.title', 'h1')}
    </div>
    ${text('history.intro', 'p', 'page-intro')}
  </div>

  ${
    v.submissions?.length
      ? `
    <div class="submission-list" role="table" ${translated_attribute('aria.submission_history')}>
      <div class="submission-row submission-row--header" role="row">
        ${text('history.title_col', 'span')}
        ${text('history.file_col', 'span')}
        ${text('history.date_col', 'span')}
      </div>
      ${(v.submissions || [])
        .map(
          (submission) => `
        <article class="submission-row" role="row">
          <strong role="cell">${escape(submission.title)}</strong>
          <span class="filename" role="cell">${escape(submission.original_filename)}</span>
          <time role="cell" datetime="${escape(submission.created_at)}" data-local-date>
            ${escape(submission.created_at.slice(0, 10))}
          </time>
        </article>
      `,
        )
        .join('')}
    </div>
  `
      : `
    <div class="empty-state">
      <span class="empty-state__symbol" aria-hidden="true">◎</span>
      ${text('history.empty', 'p')}
    </div>
  `
  }
</section>
`;
}
export function newSubmission(v: View): string {
  return `
<section
  class="page-panel page-panel--new"
  data-section="new"
  data-page-title-en="${escape(tr['new.title']['en'])}"
  data-page-title-scn="${escape(tr['new.title']['scn'])}"
  data-page-title-it="${escape(tr['new.title']['it'])}"
>
  <div class="page-heading">
    <div>
      ${text('new.title', 'h1')}
    </div>
    ${text('new.intro', 'p', 'page-intro')}
  </div>
  ${submissionForm(v)}
</section>
`;
}
export function success(v: View): string {
  const submission = v.submission!;
  return `
<div id="submission-workspace" class="success-card" role="status" aria-live="polite" tabindex="-1">
  <div class="success-seal" aria-hidden="true">
    <svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-width="2"/><path d="m19 33 8 8 18-20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </div>
  ${text('success.title', 'h2')}
  ${text('success.message', 'p', 'success-message')}
  <dl class="receipt">
    <div>
      ${text('success.title_label', 'dt')}
      <dd>${escape(submission.title)}</dd>
    </div>
    <div>
      ${text('success.file_label', 'dt')}
      <dd>${escape(submission.original_filename)}</dd>
    </div>
  </dl>
  <a
    class="button button--primary"
    href="${escape('/submissions/new')}"
    hx-get="${escape('/submissions/new')}"
    hx-target="#app-content"
    hx-swap="innerHTML show:top"
    hx-push-url="true"
  >
    ${text('success.another')}
    <span aria-hidden="true">＋</span>
  </a>
</div>
`;
}

