import type { TicketOriginDisplay } from './ticket.interfaces';

/**
 * External system registry and ticket/comment external-reference links.
 *
 * A ticket (or one of its comments) may hold many structured references to
 * records in external systems — the Discord thread it was raised in, the
 * GitHub issue it mirrors, the vendor case it references. Built-in systems are
 * declared in code; tenants may add their own under the `custom:<slug>`
 * namespace. See docs/plans/2026-09-13-ticket-external-system-link-plan.md.
 */

export const EXTERNAL_ENTITY_LINK_ENTITY_TYPES = ['ticket', 'comment'] as const;
export type ExternalEntityLinkEntityType =
  (typeof EXTERNAL_ENTITY_LINK_ENTITY_TYPES)[number];

export const EXTERNAL_LINK_RELATIONSHIPS = ['origin', 'mirror', 'reference'] as const;
export type ExternalLinkRelationship =
  (typeof EXTERNAL_LINK_RELATIONSHIPS)[number];

/** Built-in keys are lowercase `[a-z0-9_]+`; tenant systems are `custom:<slug>`. */
export const BUILT_IN_EXTERNAL_SYSTEM_KEY_PATTERN = /^[a-z0-9_]+$/;
export const CUSTOM_EXTERNAL_SYSTEM_KEY_PREFIX = 'custom:';
export const CUSTOM_EXTERNAL_SYSTEM_KEY_PATTERN = /^custom:[a-z0-9_]+$/;

export interface ExternalSystemActor {
  id?: string | null;
  handle?: string | null;
  display_name?: string | null;
  url?: string | null;
}

export interface ExternalSystemDefinition {
  /** Registry key: a built-in key or `custom:<slug>`. */
  key: string;
  label: string;
  /** lucide icon export name; the UI resolves it to a component. */
  icon: string;
  /** `{realm}` and `{external_id}` placeholders. Absent means a URL is required. */
  urlTemplate?: string;
  /** Human label for the realm field, e.g. 'Repository', 'Server'. */
  realmLabel?: string;
  /** How an origin link for this system maps to the ticket origin badge. */
  originCategory: TicketOriginDisplay;
}

export const BUILT_IN_EXTERNAL_SYSTEMS: readonly ExternalSystemDefinition[] = [
  {
    key: 'discord',
    label: 'Discord',
    icon: 'MessagesSquare',
    urlTemplate: 'https://discord.com/channels/{realm}/{external_id}',
    realmLabel: 'Server',
    originCategory: 'other',
  },
  {
    key: 'slack',
    label: 'Slack',
    icon: 'Hash',
    urlTemplate: 'https://{realm}.slack.com/archives/{external_id}',
    realmLabel: 'Workspace',
    originCategory: 'other',
  },
  {
    key: 'github',
    label: 'GitHub',
    icon: 'Github',
    urlTemplate: 'https://github.com/{realm}/issues/{external_id}',
    realmLabel: 'Repository',
    originCategory: 'other',
  },
  {
    key: 'jira',
    label: 'Jira',
    icon: 'SquareKanban',
    urlTemplate: 'https://{realm}/browse/{external_id}',
    realmLabel: 'Site',
    originCategory: 'other',
  },
  {
    key: 'email',
    label: 'Email',
    icon: 'Mail',
    originCategory: 'inbound_email',
  },
  {
    key: 'client_portal',
    label: 'Client Portal',
    icon: 'Globe',
    originCategory: 'client_portal',
  },
  {
    key: 'api',
    label: 'API',
    icon: 'Plug',
    originCategory: 'api',
  },
  {
    key: 'generic',
    label: 'External Reference',
    icon: 'Link',
    originCategory: 'other',
  },
] as const;

export interface ITenantExternalSystem {
  tenant?: string;
  /** Must match `custom:[a-z0-9_]+` and must not collide with a built-in key. */
  key: string;
  label: string;
  url_template: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Deliberately excludes internal link identifiers, actor data, and metadata. */
export interface PortalTicketExternalLink {
  label: string;
  url: string;
}

export interface IExternalEntityLink {
  /** Missing legacy values are private. */
  portal_visible?: boolean;
  tenant?: string;
  link_id?: string;
  entity_type: ExternalEntityLinkEntityType;
  /** The ticket_id or comment_id the link describes. */
  entity_id: string;
  /** Always set; denormalized ticket id for comment links. */
  ticket_id: string;
  /** Registry key: built-in or `custom:<slug>`. */
  system: string;
  external_id: string;
  /** For comment links, the ticket-level external id (thread / issue). */
  external_parent_id?: string | null;
  realm?: string | null;
  /** Explicit link-out; overrides the system's urlTemplate when present. */
  url?: string | null;
  relationship: ExternalLinkRelationship;
  actor?: ExternalSystemActor | null;
  external_status?: string | null;
  external_updated_at?: string | null;
  last_synced_at?: string | null;
  metadata?: Record<string, unknown> | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}
