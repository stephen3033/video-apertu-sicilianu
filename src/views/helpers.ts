import { escape } from '../utils/html';
import { message } from '../i18n/messages';
export const text = (key: string, tag = 'span', cls = '') =>
  `<${tag}${cls ? ` class="${escape(cls)}"` : ''} data-i18n-key="${escape(key)}" data-i18n-en="${escape(message(key))}" data-i18n-scn="${escape(message(key, 'scn'))}" data-i18n-it="${escape(message(key, 'it'))}">${escape(message(key))}</${tag}>`;
export const translated_attribute = (key: string, attr = 'aria-label') =>
  `${attr}="${escape(message(key))}" data-i18n-attribute="${attr}" data-i18n-attr-en="${escape(message(key))}" data-i18n-attr-scn="${escape(message(key, 'scn'))}" data-i18n-attr-it="${escape(message(key, 'it'))}"`;
export const errors = (items: string[] = []) =>
  items.length
    ? `<div class="form-errors" role="alert" aria-live="polite">${text('error.summary', 'p', 'form-errors__title')}<ul>${items.map((key) => text(key, 'li')).join('')}</ul></div>`
    : '';
