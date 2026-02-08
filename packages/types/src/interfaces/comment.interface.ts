import { TenantEntity } from './index';

export type CommentAuthorType = 'internal' | 'client' | 'contact' | 'system' | 'unknown';
export const COMMENT_RESPONSE_SOURCES = {
  CLIENT_PORTAL: 'client_portal',
  INBOUND_EMAIL: 'inbound_email',
} as const;

export type CommentResponseSource =
  (typeof COMMENT_RESPONSE_SOURCES)[keyof typeof COMMENT_RESPONSE_SOURCES];
export type InboundEmailProviderType = 'google' | 'microsoft' | 'imap';

export interface CommentMetadataEmail {
  provider?: InboundEmailProviderType;
  [key: string]: unknown;
}

export interface CommentMetadata {
  responseSource?: CommentResponseSource;
  email?: CommentMetadataEmail;
  [key: string]: unknown;
}

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
  metadata?: CommentMetadata | null;
  response_source?: CommentResponseSource;
}
