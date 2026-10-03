import { Hono } from 'hono';
import { type App } from '../../runtime/context';

import { authHome, emailEntry, handleCode, logout } from '../../services/auth';
export const auth = new Hono<App>();
auth.get('/', authHome);
auth.get('/auth/email', emailEntry);
auth.post('/auth/code/:action', handleCode);
auth.post('/auth/logout', logout);
