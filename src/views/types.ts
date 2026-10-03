import { type Submission, type User } from '../domain/models';
export interface View {
  csrf_token: string;
  user?: User | null;
  reviewer?: boolean;
  auth_errors?: string[];
  auth_email?: string;
  auth_locale?: string;
  masked_email?: string;
  challenge_id?: string;
  auth_notice?: string;
  errors?: string[];
  form_title?: string;
  form_notes?: string;
  submissions?: Submission[];
  submission?: Submission;
  content?: string;
}
