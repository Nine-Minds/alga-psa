import { TenantEntity } from './index';

export type CommentAuthorType = 'internal' | 'client' | 'unknown';

export interface IComment extends TenantEntity {
  comment_id?: string;
  ticket_id?: string;
  user_id?: string;
  author_type: CommentAuthorType;
  note?: string;
  is_internal?: boolean; // Only comments with author_type='internal' can be internal
  is_resolution?: boolean;
  is_system_generated?: boolean;
  created_at?: string;
  updated_at?: string;
  markdown_content?: string;
}
