import { type JobMessage } from '../domain/models';
export interface Env {
  DB: D1Database;
  STAGING_BUCKET: R2Bucket;
  PUBLICATION_QUEUE: Queue<JobMessage>;
  ASSETS: Fetcher;
  APP_ENV: 'local' | 'preview' | 'production';
  APP_ORIGIN: string;
  EMAIL_BACKEND: 'console' | 'resend' | 'test';
  EMAIL_FROM: string;
  AUTH_CODE_SECRET: string;
  RESEND_API_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  IA_ACCESS_KEY: string;
  IA_SECRET_KEY: string;
  IA_ITEM_PREFIX: string;
  DEAD_LETTER_QUEUE: string;
  LOCAL_UPLOAD_ORIGIN?: string;
  TEST_EMAIL?: Fetcher;
}
