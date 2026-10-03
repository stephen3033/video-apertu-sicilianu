import { translate, syncNavigation, currentLanguage } from './ui';
import { showRequestError } from './errors';
import './uploads';
import { message } from '../i18n/messages';
interface HtmxDetail {
  target: HTMLElement;
  xhr: XMLHttpRequest;
  shouldSwap: boolean;
  isError: boolean;
  parameters: Record<string, unknown>;
  verb: string;
}
document.body.addEventListener('htmx:configRequest', (event) => {
  const detail = (event as CustomEvent<HtmxDetail>).detail;
  if (detail.verb.toLowerCase() !== 'get') detail.parameters.locale = currentLanguage();
});
  document.body.addEventListener('htmx:afterSwap', (event) => {
    // An outerHTML swap reports the element that was replaced, so localize the
    // live document instead of relying on that possibly detached target.
    translate(document);
    syncNavigation();
    const focusTarget = (event as CustomEvent<HtmxDetail>).detail.target?.querySelector<HTMLElement>("h1, h2, [tabindex='-1']");
    if (focusTarget) {
      focusTarget.setAttribute('tabindex', '-1');
      focusTarget.focus({ preventScroll: true });
    }
  });

  document.body.addEventListener('htmx:beforeSwap', (event) => {
    const detail = (event as CustomEvent<HtmxDetail>).detail;
    if (detail.xhr.status >= 400 && !detail.xhr.getResponseHeader('HX-Redirect')) {
      if (detail.xhr.getResponseHeader('Content-Type')?.includes('text/html')) {
        detail.shouldSwap = true;
      } else {
        let key = 'error.upload';
        try { key = JSON.parse(detail.xhr.responseText).error || key; } catch { /* Use localized fallback. */ }
        showRequestError(detail.target, message(key, currentLanguage()));
        detail.shouldSwap = false;
      }
      detail.isError = false;
    }
  });

  document.body.addEventListener('htmx:historyRestore', () => {
    translate(document);
    syncNavigation();
  });

  translate(document);
  syncNavigation();
