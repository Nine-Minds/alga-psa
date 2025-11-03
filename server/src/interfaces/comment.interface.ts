import { TenantEntity } from './index';

export type CommentAuthorType = 'internal' | 'client' | 'unknown';

export interface IComment extends TenantEntity {
  comment_id?: string;
  ticket_id?: string;
  project_task_id?: string;
  project_phase_id?: string;
  user_id?: string;
  contact_name_id?: string;
  contact_id?: string;
  author_type: CommentAuthorType;
  note?: string;
  is_internal?: boolean; // Only comments with author_type='internal' can be internal
  is_resolution?: boolean;
  is_initial_description?: boolean;
  created_at?: string;
  updated_at?: string;
  markdown_content?: string;
}
