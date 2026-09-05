import { TenantEntity } from './index';

export type CommentAuthorType = 'internal' | 'client' | 'contact' | 'system' | 'unknown';
export const COMMENT_RESPONSE_SOURCES = {
  CLIENT_PORTAL: 'client_portal',
  INBOUND_EMAIL: 'inbound_email',
} as const;

/**
 * Canonical comment authorship linkage.
 *
 * - Internal/system comments generally have `user_id` and no `contact_id`.
 * - Contact-only comments have `contact_id` and no `user_id`.
 * - Client-user comments can carry both IDs, preserving user identity while
 *   retaining contact linkage for display/notification fallbacks.
 */
export interface CommentAuthorship {
  author_type: CommentAuthorType;
  user_id?: string | null;
  contact_id?: string | null;
}

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
  thread_id?: string;
  parent_comment_id?: string | null;
  user_id?: string | null;
  contact_id?: string | null;
  author_type: CommentAuthorType;
  note?: string;
  is_internal?: boolean; // Only comments with author_type='internal' can be internal
  is_resolution?: boolean;
  is_system_generated?: boolean;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  markdown_content?: string;
  metadata?: CommentMetadata | null;
  response_source?: CommentResponseSource;
  /** Client-visible comments may be withheld until their scheduled UTC instant. */
  publish_state?: 'published' | 'scheduled' | 'canceled';
  scheduled_publish_at?: string | null;
  scheduled_publish_tz?: string | null;
  published_at?: string | null;
  schedule_job_id?: string | null;
  scheduled_publish_event_id?: string | null;
  scheduled_publish_dispatched_at?: string | null;
  scheduled_response_event_id?: string | null;
  scheduled_previous_response_state?: string | null;
  scheduled_response_dispatched_at?: string | null;
}
