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
  type ExternalSystemDefinition,
  type IExternalEntityLink,
  type ITenantExternalSystem,
} from '@alga-psa/types';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  writeTicketActivity,
} from '@alga-psa/shared/lib/ticketActivity';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import {
  renderExternalLinkUrl,
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
  | 'system_label_required'
  | 'url_required'
  | 'invalid_visibility';

export class ExternalLinkValidationError extends Error {
  readonly code: ExternalLinkErrorCode;

  constructor(code: ExternalLinkErrorCode, message: string) {
    super(message);
    this.name = 'ExternalLinkValidationError';
    this.code = code;
  }
}

export interface AddExternalLinkInput {
  portal_visible?: boolean;
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
  portal_visible?: boolean;
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

export function validatePortalVisibility(value: unknown, entityType: ExternalEntityLinkEntityType): boolean {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new ExternalLinkValidationError('invalid_visibility', 'Visibility must be a boolean');
  }
  if (value === true && entityType !== 'ticket') {
    throw new ExternalLinkValidationError('invalid_visibility', 'Only ticket-level links can be shared');
  }
  return value === true;
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

/**
 * A link is only useful if it resolves to a clickable http(s) destination.
 * Reject a create/update that would persist a row with nowhere to go — e.g. a
 * template system with no realm, or a generic system with no explicit URL.
 */
export function assertLinkDestination(
  definition: ExternalSystemDefinition | null,
  link: Pick<IExternalEntityLink, 'external_id' | 'realm' | 'url'>,
): void {
  if (!renderExternalLinkUrl(definition, link)) {
    throw new ExternalLinkValidationError(
      'url_required',
      'A clickable URL is required: provide an explicit URL or the fields the external system template needs',
    );
  }
}

export interface PreparedExternalLink {
  portal_visible: boolean;
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
  const portalVisible = validatePortalVisibility(input.portal_visible, entityType);

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

  const realm = input.realm?.trim() || null;
  assertLinkDestination(definition, { external_id: externalId, realm, url });

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
    portal_visible: portalVisible,
    entity_type: entityType,
    entity_id: entityId,
    ticket_id: input.ticket_id,
    system: definition.key,
    external_id: externalId,
    external_parent_id: input.external_parent_id?.trim() || null,
    realm,
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
 * Insert a prepared link. Conflicts surface as structured errors and abort the
 * surrounding transaction — a conflicting link must roll back the entity it was
 * created with, never be silently dropped. The DB uniqueness indexes are the
 * backstop; the pre-checks give a clean error instead of a raw 23505.
 */
export async function insertExternalLink(
  trx: Knex.Transaction,
  tenant: string,
  prepared: PreparedExternalLink,
  createdBy: string | null,
): Promise<IExternalEntityLink> {
  const duplicate = await tenantTable(trx, tenant, 'external_entity_links')
    .where({
      entity_type: prepared.entity_type,
      system: prepared.system,
      external_id: prepared.external_id,
    })
    .whereRaw("COALESCE(external_parent_id, '') = ?", [prepared.external_parent_id ?? ''])
    .select('link_id')
    .first();
  if (duplicate) {
    throw new ExternalLinkValidationError(
      'duplicate_external_link',
      'That external record is already linked',
    );
  }

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
 * Publish a link lifecycle event after the write transaction commits. Best
 * effort: a broker outage must not roll back a persisted link.
 */
export async function publishExternalLinkEvent(
  eventType: 'TICKET_EXTERNAL_LINK_ADDED' | 'TICKET_EXTERNAL_LINK_UPDATED' | 'TICKET_EXTERNAL_LINK_REMOVED',
  tenant: string,
  row: IExternalEntityLink,
  userId: string | null,
): Promise<void> {
  try {
    await publishEvent({
      eventType,
      payload: {
        tenantId: tenant,
        occurredAt: new Date().toISOString(),
        ...(userId ? { actorUserId: userId, userId } : {}),
        ticketId: row.ticket_id,
        linkId: row.link_id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        system: row.system,
        externalId: row.external_id,
        externalParentId: row.external_parent_id ?? null,
        relationship: row.relationship,
      },
    } as never);
  } catch (error) {
    console.error('[externalLinks] failed to publish event', { eventType, error });
  }
}

/**
 * Atomically create the inline links for a ticket/comment create. Each inserted
 * link gets its planned audit entry in this same transaction; events are
 * published by the caller only after the transaction commits. Any conflict (a
 * second origin, a duplicate external record, an unusable destination) throws
 * and rolls the whole entity creation back.
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
  const tenantSystems = await loadTenantExternalSystems(trx, tenant);
  const inserted: IExternalEntityLink[] = [];
  for (const link of links) {
    // Imports and inline entity creation never share links; use an authorized explicit link mutation.
    const prepared = await prepareExternalLink(trx, tenant, { ...link, ticket_id: ticketId, portal_visible: false });
    const row = await insertExternalLink(trx, tenant, prepared, createdBy);

    await writeTicketActivity(trx, {
      tenant,
      ticketId: row.ticket_id,
      eventType: TICKET_ACTIVITY_EVENT.EXTERNAL_LINK_ADDED,
      entityType: TICKET_ACTIVITY_ENTITY.SYSTEM,
      entityId: row.link_id,
      actor: {
        actorType: TICKET_ACTIVITY_ACTOR.USER,
        userId: createdBy ?? undefined,
      },
      source: TICKET_ACTIVITY_SOURCE.EXTERNAL_LINK,
      occurredAt: new Date().toISOString(),
      details: {
        system: row.system,
        system_label: resolveExternalSystem(tenantSystems, row.system)?.label ?? row.system,
        external_id: row.external_id,
        relationship: row.relationship,
        entity_type: row.entity_type,
        portal_visible: row.portal_visible === true,
      },
    });

    inserted.push(row);
  }
  return inserted;
}
