import { type Submission } from '../domain/models';
import { BUDGET } from '../domain/limits';
import { iso } from '../utils/time';
import { escape } from '../utils/html';
import { text } from './helpers';
export interface ReviewTotals { bytes: number; cleanup: number; oldest_pending: string | null; oldest_job: number | null }
export function reviewContent(rows: Submission[], totals: ReviewTotals | null, csrfToken: string) {
  const action = (s: Submission, verb: string) =>
    `<form method="post" action="/review/${s.id}/${verb}" hx-post="/review/${s.id}/${verb}" hx-target="#app-content" hx-swap="innerHTML" hx-disabled-elt="find button"><input type="hidden" name="csrf_token" value="${escape(csrfToken)}"><button class="button" type="submit">${text('review.' + verb)}</button></form>`;
  return `<section class="page-panel" data-section="review"><div class="page-heading">${text('nav.review', 'h1')}</div><div class="review-utilization"><p>${text('review.capacity')}: <strong>${totals?.bytes || 0} / ${BUDGET}</strong> ${text('review.bytes')}</p><progress max="${BUDGET}" value="${totals?.bytes || 0}"></progress><p>${text('review.backlog')}: ${totals?.cleanup || 0}</p><p>${text('review.oldest_pending')}: ${escape(totals?.oldest_pending || '—')}</p><p>${text('review.oldest_job')}: ${totals?.oldest_job ? escape(iso(totals.oldest_job)) : '—'}</p></div>
    ${
      rows.length
        ? rows
            .map(
              (
                s,
              ) => `<article class="review-card" data-review-id="${s.id}"><h2>${escape(s.title)}</h2><p class="review-notes">${escape(s.notes)}</p><dl class="receipt"><div><dt>${text('review.contributor')}</dt><dd>${escape(s.email)}</dd></div><div><dt>${text('form.file')}</dt><dd>${escape(s.original_filename)} · ${escape(s.media_kind)} · ${escape(s.content_type)} · ${s.byte_size} ${text('review.bytes')}</dd></div><div><dt>${text('history.date_col')}</dt><dd><time datetime="${escape(s.created_at)}" data-local-date>${escape(s.created_at)}</time></dd></div><div><dt>${text('review.decision')}</dt><dd>${text(s.review_decision === 'accepted' ? 'review.approved' : s.review_decision === 'rejected' ? 'review.rejected' : 'review.pending')}</dd></div><div><dt>${text('review.status')}</dt><dd>${text('review.' + s.lifecycle)}${s.last_error ? ` (${escape(s.last_error)})` : ''}</dd></div></dl><div class="form-actions">
    ${!['published', 'rejected', 'legacy'].includes(s.lifecycle) ? `<a class="button" href="/review/${s.id}/download">${text('review.download')}</a>` : ''}
    ${s.review_decision === 'pending' && s.lifecycle === 'pending' ? action(s, 'accept') + action(s, 'reject') : ''}${s.lifecycle === 'failed' ? action(s, 'retry') : ''}</div></article>`,
            )
            .join('')
        : text('review.empty', 'p')
    }</section>`;
}
