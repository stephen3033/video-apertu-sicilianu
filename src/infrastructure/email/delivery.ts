import copy from '../../i18n/email-copy.json';
import { type Env } from '../../runtime/bindings';
import { escape } from '../../utils/html';
export async function sendCode(env: Env, to: string, code: string, locale: string, id: string) {
  const words = copy[locale as keyof typeof copy] || copy.en;
  const text = `${words.heading}\n\n${words.intro}\n\n${code}\n\n${words.expiry}\n${words.ignore}\n`;
  const html = `<!doctype html><html><body><h1>${escape(words.heading)}</h1><p>${escape(words.intro)}</p><p style="font-size:2rem;font-weight:bold;letter-spacing:.25em">${code}</p><p>${escape(words.expiry)}</p><p>${escape(words.ignore)}</p></body></html>`;
  if (env.APP_ENV === 'local' && env.EMAIL_BACKEND === 'test' && env.TEST_EMAIL) {
    const r = await env.TEST_EMAIL.fetch('https://test-email.local/', {
      method: 'POST',
      body: JSON.stringify({ to, code, locale }),
    });
    if (!r.ok) throw new Error('email_delivery');
    return;
  }
  if (env.APP_ENV === 'local' && env.EMAIL_BACKEND === 'console') {
    console.log(`[login-code] to=${to} locale=${locale} code=${code}`);
    return;
  }
  if (env.EMAIL_BACKEND !== 'resend' || !env.RESEND_API_KEY) throw new Error('email_configuration');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': id,
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: words.subject, text, html }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('email_delivery');
  }
  await response.body?.cancel();
}
