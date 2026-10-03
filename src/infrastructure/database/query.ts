import { type Env } from '../../runtime/bindings';
export const sql = (env: Env, query: string, ...values: (string | number | null)[]) =>
  env.DB.prepare(query).bind(...values);
