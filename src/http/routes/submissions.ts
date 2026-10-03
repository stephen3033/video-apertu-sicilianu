import { Hono } from 'hono';
import { type App } from '../../runtime/context';
import { csrf, requireUser } from '../middleware/guards';
import { submissionHistory, submissionPage, createSubmission } from '../../services/submissions';
export const submissions = new Hono<App>();
submissions.use('*', requireUser);
submissions.get('/', submissionHistory);
submissions.get('/new', submissionPage);
submissions.post('/', csrf, createSubmission);
