export function showRequestError(target: Element | null, message: string) {
  const container = target?.closest('#submission-workspace, #app-content, #auth-panel') || document.querySelector('main');
  if (!container) return;
  let alert = container.querySelector<HTMLElement>('[data-request-error]');
  if (!alert) {
    alert = document.createElement('p');
    alert.className = 'form-errors';
    alert.setAttribute('role', 'alert');
    alert.dataset.requestError = '';
    alert.dataset.uploadError = '';
    container.prepend(alert);
  }
  alert.textContent = message;
}
