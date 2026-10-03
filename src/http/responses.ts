import { type Ctx } from '../runtime/context';
import { htmx } from './requests';
import { isReviewer } from './middleware/guards';
import { page } from '../views/layouts';
export async function appResponse(c: Ctx, content: string) {
  const v = {
    csrf_token: c.get('session').csrf_token,
    user: c.get('user'),
    reviewer: await isReviewer(c),
  };
  return c.html(htmx(c) ? content : page(v, content, true));
}
