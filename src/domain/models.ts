export interface JobMessage {
  job_id: string;
  generation: number;
  step: number;
}
export interface User {
  id: string;
  email: string;
  created_at: string;
  email_verified_at: string | null;
}
export interface Session {
  token_hash: string;
  csrf_token: string;
  user_id: string | null;
  expires_at: number;
  authenticated_at: number | null;
}
export interface Challenge {
  id: string;
  email: string;
  locale: string;
  code_digest: string;
  created_at: string;
  expires_at: string;
  attempt_window_started_at: string;
  failed_attempts: number;
  consumed_at: string | null;
}
export interface Upload {
  id: string;
  user_id: string;
  object_key: string;
  original_filename: string;
  content_type: string;
  media_kind: string;
  byte_size: number;
  phase: string;
  status: string;
  multipart_id: string | null;
  etag: string | null;
  expires_at: number;
  lease_until: number;
  idempotency_key: string;
}
export interface Submission {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  original_filename: string;
  content_type: string;
  media_kind: string;
  byte_size: number;
  storage_ref: string;
  created_at: string;
  upload_id: string;
  r2_etag: string;
  ia_item: string;
  upstream_url: string | null;
  review_decision: string;
  lifecycle: string;
  email?: string;
  last_error?: string;
}
export interface Job {
  id: string;
  submission_id: string;
  kind: string;
  state: string;
  resume_state: string | null;
  generation: number;
  step: number;
  multipart_id: string | null;
  expected_etag: string | null;
  lease_token: string;
  lease_until: number;
  attempts: number;
  total_attempts: number;
  next_attempt_at: number;
  updated_at: number;
}
