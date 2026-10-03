import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { type App } from '../runtime/context';
import { sessions } from './middleware/sessions';
import { body } from './middleware/body';
import { auth } from './routes/auth';
import { uploads } from './routes/uploads';
import { submissions } from './routes/submissions';
import { review } from './routes/review';

import { localUpload } from '../infrastructure/storage/local-upload';
import { message } from '../i18n/messages';
const app = new Hono<App>();
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Frame-Options', 'DENY');
  if (c.req.path.startsWith('/static/') || c.req.path.startsWith('/vendor/htmx/'))
    return c.env.ASSETS.fetch(c.req.raw);
  if (c.req.path.startsWith('/__local/')) return localUpload(c.req.raw, c.env);
  if (
    c.env.APP_ENV !== 'local' &&
    (!['preview', 'production'].includes(c.env.APP_ENV) ||
      c.env.LOCAL_UPLOAD_ORIGIN ||
      c.env.EMAIL_BACKEND !== 'resend' ||
      !c.env.AUTH_CODE_SECRET ||
      c.env.AUTH_CODE_SECRET.length < 32 ||
      !c.env.RESEND_API_KEY ||
      !c.env.R2_ACCESS_KEY_ID ||
      !c.env.R2_SECRET_ACCESS_KEY ||
      !c.env.IA_ACCESS_KEY ||
      !c.env.IA_SECRET_KEY)
  )
    return c.text('Configuration unavailable', 503);
  await next();
});
app.use('*', sessions, body);
app.route('/', auth);
app.route('/uploads', uploads);
app.route('/submissions', submissions);
app.route('/review', review);
app.onError((error, c) => {
  const status = error instanceof HTTPException ? error.status : 500;
  const key =
    error instanceof HTTPException && error.message.startsWith('error.')
      ? error.message
      : 'error.upload';
  if (status >= 500)
    console.log(JSON.stringify({ event: 'request_failed', status, category: key }));
  return c.json(
    {
      error: key,
      message: message(
        key,
        typeof c.get('form')?.locale === 'string' ? (c.get('form').locale as string) : 'en',
      ),
    },
    status,
  );
});
export { app };
