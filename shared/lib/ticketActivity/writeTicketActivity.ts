/**
 * Ticket activity helper. Persists rows to `ticket_audit_logs` using an
 * explicit tenant (does NOT depend on the `app.current_tenant` GUC) so it
 * works inside both normal request transactions and admin transactions used
 * by inbound email / workflow paths.
 *
 * Failure semantics:
 * - The write itself fails fast. Callers that want best-effort behavior must
 *   wrap the call themselves; v1 prefers strong consistency in the same
 *   transaction as the underlying ticket/comment mutation.
 * - Display-name enrichment is optional. Callers may pass a pre-resolved
 *   `actor.displayName`; if absent, we fall back to a best-effort lookup
 *   and ignore lookup failures.
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';

import {
  TICKET_ACTIVITY_ACTOR,
  type TicketActivityChanges,
  type WriteTicketActivityInput,
} from './types';

function toIso(value: string | Date | undefined): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function isEmptyChanges(changes: TicketActivityChanges | undefined): boolean {
  if (!changes) return true;
  return Object.keys(changes).length === 0;
}

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

async function resolveUserDisplayName(
  knex: Knex | Knex.Transaction,
  tenant: string,
  userId: string,
): Promise<string | null> {
  try {
    const row = await tenantScopedTable(knex, 'users', tenant)
      .where({ user_id: userId })
      .first(['first_name', 'last_name', 'email']);
    if (!row) return null;
    const first = (row.first_name ?? '').trim();
    const last = (row.last_name ?? '').trim();
    const full = [first, last].filter(Boolean).join(' ').trim();
    return full.length > 0 ? full : (row.email ?? null);
  } catch (err) {
    // Display-name enrichment is best-effort; never fail the activity write
    // because of an enrichment lookup error.
    console.warn('[ticketActivity] failed to resolve user display name', {
      userId,
      tenant,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function resolveContactDisplayName(
  knex: Knex | Knex.Transaction,
  tenant: string,
  contactId: string,
): Promise<string | null> {
  try {
    const row = await tenantScopedTable(knex, 'contacts', tenant)
      .where({ contact_name_id: contactId })
      .first(['full_name', 'email']);
    if (!row) return null;
    const full = (row.full_name ?? '').toString().trim();
    return full.length > 0 ? full : (row.email ?? null);
  } catch (err) {
    console.warn('[ticketActivity] failed to resolve contact display name', {
      contactId,
      tenant,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Insert one ticket activity row.
 *
 * @param knex Knex instance OR Transaction. Pass the active transaction when
 *             logging inside a ticket/comment mutation so the activity row is
 *             rolled back atomically on failure.
 * @param input The activity payload. `tenant` and `ticketId` are required;
 *              this helper never reads `app.current_tenant` and is safe in
 *              admin transactions.
 */
export async function writeTicketActivity(
  knex: Knex | Knex.Transaction,
  input: WriteTicketActivityInput,
): Promise<string> {
  if (!input.tenant) {
    throw new Error('writeTicketActivity requires an explicit tenant');
  }
  if (!input.ticketId) {
    throw new Error('writeTicketActivity requires a ticketId');
  }
  if (!input.eventType) {
    throw new Error('writeTicketActivity requires an eventType');
  }
  if (!input.entityType) {
    throw new Error('writeTicketActivity requires an entityType');
  }
  if (!input.actor?.actorType) {
    throw new Error('writeTicketActivity requires actor.actorType');
  }
  if (!input.source) {
    throw new Error('writeTicketActivity requires a source');
  }

  const auditId = uuidv4();
  const occurredAt = toIso(input.occurredAt);

  // Best-effort display name resolution if the caller didn't supply one.
  let displayName = input.actor.displayName ?? null;
  if (!displayName) {
    if (
      input.actor.actorType === TICKET_ACTIVITY_ACTOR.USER &&
      input.actor.userId
    ) {
      displayName = await resolveUserDisplayName(
        knex,
        input.tenant,
        input.actor.userId,
      );
    } else if (
      (input.actor.actorType === TICKET_ACTIVITY_ACTOR.CONTACT ||
        input.actor.actorType === TICKET_ACTIVITY_ACTOR.EMAIL_SENDER) &&
      input.actor.contactId
    ) {
      displayName = await resolveContactDisplayName(
        knex,
        input.tenant,
        input.actor.contactId,
      );
    }
  }

  const changes = isEmptyChanges(input.changes) ? {} : input.changes ?? {};
  const details = input.details ?? {};

  await tenantScopedTable(knex, 'ticket_audit_logs', input.tenant).insert({
    tenant: input.tenant,
    audit_id: auditId,
    ticket_id: input.ticketId,
    event_type: input.eventType,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    actor_type: input.actor.actorType,
    actor_user_id: input.actor.userId ?? null,
    actor_contact_id: input.actor.contactId ?? null,
    actor_display_name: displayName,
    source: input.source,
    occurred_at: occurredAt,
    changes: JSON.stringify(changes),
    details: JSON.stringify(details),
    created_at: new Date().toISOString(),
  });

  return auditId;
}
