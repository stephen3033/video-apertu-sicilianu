import { escape } from '../utils/html';
import { text, translated_attribute } from './helpers';

export const mark = () => `
<span class="brand-mark" aria-hidden="true">
  <svg viewBox="0 0 44 44" role="img">
    <path d="M22 3 39 13v18L22 41 5 31V13L22 3Z" fill="currentColor" opacity=".13"/>
    <path d="M22 8.5 34.5 16v12L22 35.5 9.5 28V16L22 8.5Z" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="22" cy="22" r="4.2" fill="currentColor"/>
    <path d="M22 12.5v5M22 26.5v5M12.5 22h5M26.5 22h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
  </svg>
</span>
`;
export const language_selector = (location = 'header') => `
<label class="language-picker language-picker--${escape(location)}">
  ${text('language.label', 'span', 'sr-only')}
  <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17">
    <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.1-2.3 3.2-5.3 3.2-9S14.1 5.3 12 3m0 18c-2.1-2.3-3.2-5.3-3.2-9S9.9 5.3 12 3M3.6 9h16.8M3.6 15h16.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>
  <select data-language-select ${translated_attribute('language.label')}>
    <option value="en">English</option>
    <option value="scn">Sicilianu</option>
    <option value="it">Italiano</option>
  </select>
</label>
`;
