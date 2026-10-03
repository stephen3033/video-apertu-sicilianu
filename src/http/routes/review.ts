import { Hono } from 'hono';
import { type App } from '../../runtime/context';
import { csrf, requireReviewer } from '../middleware/guards';
import { reviewPage, downloadSubmission, reviewDecision } from '../../services/review';
export const review = new Hono<App>();
review.use('*', requireReviewer);
review.get('/', reviewPage);
review.get('/:id/download', downloadSubmission);
review.post('/:id/:action', csrf, reviewDecision);
