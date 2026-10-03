import type { Context } from 'hono';
import { type Env } from './bindings';
import { type Session, type User } from '../domain/models';
export type App = {
  Bindings: Env;
  Variables: { session: Session; user: User | null; form: Record<string, unknown> };
};
export type Ctx = Context<App>;
