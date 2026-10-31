/**
 * Canned ticket responses: a reusable-reply library for the ticket comment editor.
 * Separate entity from ticket templates (see migration 20261016120000_create_canned_responses).
 */

/** Who can see a response. `client_portal` responses are only offered on the client-portal surface. */
export type CannedResponseScope = 'personal' | 'team' | 'board' | 'client_portal';

export const CANNED_RESPONSE_SCOPES: readonly CannedResponseScope[] = ['personal', 'team', 'board', 'client_portal'];

/** The surface a response is being picked on. */
export type CannedResponseSurface = 'msp' | 'client_portal';

export interface ICannedResponse {
  tenant: string;
  canned_response_id: string;
  name: string;
  /** Serialized BlockNote JSON, the same format as `comments.note`. */
  body: string;
  /** Derived plain rendering of `body`; used for search and previews, rewritten on every save. */
  body_markdown: string;
  /** Free-text folder; null when uncategorised. */
  category: string | null;
  scope: CannedResponseScope;
  /** Set for `personal` scope only. */
  owner_user_id: string | null;
  /** Set for `team` scope only. */
  team_id: string | null;
  /** Set for `board` scope only. */
  board_id: string | null;
  is_active: boolean;
  /** Reserved for macros (apply a response and set ticket fields). Unused in v1. */
  actions: unknown | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A row in the admin library list. */
export interface CannedResponseListItem {
  canned_response_id: string;
  name: string;
  category: string | null;
  scope: CannedResponseScope;
  owner_user_id: string | null;
  team_id: string | null;
  team_name: string | null;
  board_id: string | null;
  board_name: string | null;
  /** First part of the markdown body. */
  preview: string;
  is_active: boolean;
  is_favorite: boolean;
  last_used_at: string | null;
  updated_at: string;
}

/** What the quick-insert picker needs per response; the body is resolved client-side on insert. */
export interface CannedResponsePickerItem {
  canned_response_id: string;
  name: string;
  category: string | null;
  scope: CannedResponseScope;
  /** Serialized BlockNote JSON. */
  body: string;
  preview: string;
  is_favorite: boolean;
  last_used_at: string | null;
}

/** Values merge fields resolve against. Missing pieces are null/empty and resolve to an empty string. */
export interface CannedResponseMergeContext {
  contact: { first_name: string | null; last_name: string | null; name: string | null };
  ticket: { number: string | null; title: string | null };
  agent: { name: string | null };
  client: { name: string | null };
}
