import type { Knex } from 'knex';
import {
  tenantDb,
} from '@alga-psa/db';
import {
  EXTERNAL_ENTITY_LINK_ENTITY_TYPES,
  EXTERNAL_LINK_RELATIONSHIPS,
  type ExternalEntityLinkEntityType,
  type ExternalLinkRelationship,
  type ExternalSystemActor,
  type IExternalEntityLink,
  type ITenantExternalSystem,
} from '@alga-psa/types';
import {
  resolveExternalSystem,
  safeExternalUrl,
} from '../../lib/externalSystems';

/**
 * Shared validation + persistence for external entity links.
 *
 * Kept outside the `'use server'` action module so ticket/comment create paths
 * (REST service, inbound integrations) can write links in the same transaction
 * as the owning entity. See
 * docs/plans/2026-09-13-ticket-external-system-link-plan.md §3 §6.
 */

export type ExternalLinkErrorCode =
  | 'ticket_not_found'
  | 'comment_not_found'
  | 'link_not_found'
  | 'system_not_found'
  | 'external_id_required'
  | 'invalid_url'
  | 'invalid_relationship'
  | 'invalid_entity_type'
  | 'origin_exists'
  | 'duplicate_external_link'
  | 'system_in_use'
  | 'invalid_system_key'
  | 'system_label_required';

export class ExternalLinkValidationError extends Error {
  readonly code: ExternalLinkErrorCode;

  constructor(code: ExternalLinkErrorCode, message: string) {
    super(message);
    this.name = 'ExternalLinkValidationError';
    this.code = code;
  }
}

export interface AddExternalLinkInput {
  ticket_id: string;
  entity_type?: ExternalEntityLinkEntityType;
  /** Required when entity_type === 'comment'. */
  comment_id?: string | null;
  system: string;
  external_id: string;
  external_parent_id?: string | null;
  realm?: string | null;
  url?: string | null;
  relationship?: ExternalLinkRelationship;
  actor?: ExternalSystemActor | null;
  external_status?: string | null;
  external_updated_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateExternalLinkPatch {
  relationship?: ExternalLinkRelationship;
  url?: string | null;
  actor?: ExternalSystemActor | null;
  external_status?: string | null;
  external_updated_at?: string | null;
  last_synced_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

function tenantTable(conn: Knex | Knex.Transaction, tenant: string, table: string): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

export async function loadTenantExternalSystems(
  conn: Knex | Knex.Transaction,
  tenant: string,
): Promise<ITenantExternalSystem[]> {
  return tenantTable(conn, tenant, 'tenant_external_systems').select('*');
}

export async function requireTicket(
  conn: Knex | Knex.Transaction,
  tenant: string,
  ticketId: string,
): Promise<{ ticket_id: string }> {
  const ticket = await tenantTable(conn, tenant, 'tickets')
    .where({ ticket_id: ticketId })
    .select('ticket_id')
    .first();
  if (!ticket) {
    throw new ExternalLinkValidationError('ticket_not_found', 'Ticket not found');
  }
  return ticket;
}

function normalizeRelationship(value: unknown): ExternalLinkRelationship {
  if (value == null) {
    return 'reference';
  }
  if (
    typeof value !== 'string'
    || !(EXTERNAL_LINK_RELATIONSHIPS as readonly string[]).includes(value)
  ) {
    throw new ExternalLinkValidationError(
      'invalid_relationship',
      "Relationship must be 'origin', 'mirror', or 'reference'",
    );
  }
  return value as ExternalLinkRelationship;
}

function normalizeEntityType(value: unknown): ExternalEntityLinkEntityType {
  if (value == null) {
    return 'ticket';
  }
  if (
    typeof value !== 'string'
    || !(EXTERNAL_ENTITY_LINK_ENTITY_TYPES as readonly string[]).includes(value)
  ) {
    throw new ExternalLinkValidationError('invalid_entity_type', "Entity type must be 'ticket' or 'comment'");
  }
  return value as ExternalEntityLinkEntityType;
}

export interface PreparedExternalLink {
  entity_type: ExternalEntityLinkEntityType;
  entity_id: string;
  ticket_id: string;
  system: string;
  external_id: string;
  external_parent_id: string | null;
  realm: string | null;
  url: string | null;
  relationship: ExternalLinkRelationship;
  actor: ExternalSystemActor | null;
  external_status: string | null;
  external_updated_at: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Validate and normalize one link input. Throws ExternalLinkValidationError on
 * any expected failure so callers can map to a structured action/API error.
 */
export async function prepareExternalLink(
  conn: Knex | Knex.Transaction,
  tenant: string,
  input: AddExternalLinkInput,
): Promise<PreparedExternalLink> {
  const entityType = normalizeEntityType(input.entity_type);
  const relationship = normalizeRelationship(input.relationship);

  const externalId = typeof input.external_id === 'string' ? input.external_id.trim() : '';
  if (!externalId) {
    throw new ExternalLinkValidationError('external_id_required', 'External ID is required');
  }

  const tenantSystems = await loadTenantExternalSystems(conn, tenant);
  const definition = resolveExternalSystem(tenantSystems, input.system);
  if (!definition) {
    throw new ExternalLinkValidationError(
      'system_not_found',
      `Unknown external system '${input.system}'`,
    );
  }

  let url: string | null = null;
  if (input.url != null && input.url !== '') {
    url = safeExternalUrl(input.url);
    if (!url) {
      throw new ExternalLinkValidationError('invalid_url', 'URL must be a valid http(s) URL');
    }
  }

  await requireTicket(conn, tenant, input.ticket_id);

  let entityId = input.ticket_id;
  if (entityType === 'comment') {
    const commentId = input.comment_id?.trim();
    if (!commentId) {
      throw new ExternalLinkValidationError('comment_not_found', 'Comment ID is required for comment links');
    }
    const comment = await tenantTable(conn, tenant, 'comments')
      .where({ comment_id: commentId, ticket_id: input.ticket_id })
      .select('comment_id')
      .first();
    if (!comment) {
      throw new ExternalLinkValidationError('comment_not_found', 'Comment not found on this ticket');
    }
    entityId = commentId;
  }

  return {
    entity_type: entityType,
    entity_id: entityId,
    ticket_id: input.ticket_id,
    system: definition.key,
    external_id: externalId,
    external_parent_id: input.external_parent_id?.trim() || null,
    realm: input.realm?.trim() || null,
    url,
    relationship,
    actor: input.actor ?? null,
    external_status: input.external_status ?? null,
    external_updated_at: input.external_updated_at ?? null,
    metadata: input.metadata ?? null,
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export function uniqueViolationTargets(error: unknown): string {
  const constraint = (error as { constraint?: string }).constraint ?? '';
  return constraint;
}

/**
 * Insert a prepared link. When `skipConflicts` is set (create paths), a duplicate
 * external record or an already-present origin is skipped and null is returned
 * rather than failing the owning transaction — so retries don't create duplicate
 * origins. Explicit action calls leave it unset and surface the conflict.
 */
export async function insertExternalLink(
  trx: Knex.Transaction,
  tenant: string,
  prepared: PreparedExternalLink,
  createdBy: string | null,
  options: { skipConflicts?: boolean } = {},
): Promise<IExternalEntityLink | null> {
  if (prepared.relationship === 'origin') {
    const existingOrigin = await tenantTable(trx, tenant, 'external_entity_links')
      .where({
        entity_type: prepared.entity_type,
        entity_id: prepared.entity_id,
        relationship: 'origin',
      })
      .select('link_id')
      .first();
    if (existingOrigin) {
      if (options.skipConflicts) {
        return null;
      }
      throw new ExternalLinkValidationError('origin_exists', 'This entity already has an origin link');
    }
  }

  try {
    const [row] = await tenantTable(trx, tenant, 'external_entity_links')
      .insert({
        tenant,
        ...prepared,
        created_by: createdBy,
      })
      .returning('*');
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const target = uniqueViolationTargets(error);
      if (options.skipConflicts) {
        return null;
      }
      if (target.includes('origin')) {
        throw new ExternalLinkValidationError('origin_exists', 'This entity already has an origin link');
      }
      throw new ExternalLinkValidationError(
        'duplicate_external_link',
        'That external record is already linked',
      );
    }
    throw error;
  }
}

/**
 * Best-effort atomic link creation for a ticket/comment create. Returns the
 * inserted rows; duplicates and origin conflicts are skipped so retries are
 * idempotent. Validation errors still throw — a malformed link should fail the
 * create rather than silently drop.
 */
export async function persistExternalLinksForCreate(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  links: Array<Omit<AddExternalLinkInput, 'ticket_id'>> | null | undefined,
  createdBy: string | null,
): Promise<IExternalEntityLink[]> {
  if (!links || links.length === 0) {
    return [];
  }
  const inserted: IExternalEntityLink[] = [];
  for (const link of links) {
    const prepared = await prepareExternalLink(trx, tenant, { ...link, ticket_id: ticketId });
    const row = await insertExternalLink(trx, tenant, prepared, createdBy, { skipConflicts: true });
    if (row) {
      inserted.push(row);
    }
  }
  return inserted;
}
