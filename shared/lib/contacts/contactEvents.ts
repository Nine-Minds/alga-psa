import { registerAfterCommit } from '@alga-psa/db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildContactArchivedPayload,
  buildContactCreatedPayload,
  buildContactUpdatedPayload,
} from '../../workflow/streams/domainEventBuilders/contactEventBuilders';
import { ContactModel } from '../../models/contactModel';
import type { Knex } from 'knex';

/**
 * Domain events for `contacts` writes that happen inside a caller-owned transaction.
 *
 * Each function defers publishing until the transaction commits (`registerAfterCommit`), so a
 * rolled-back write never emits. They are used by the write paths that call ContactModel directly
 * (client+contact dialog, portal invitations, ticket import, marketing capture, CSV import, bulk moves, inbound webhooks, Entra sync, migration applier,
 * client merge). The single-record UI action and the REST service publish inline instead.
 */

export interface ContactEventOptions {
  /** Acting user; omit for system-initiated writes (sync, imports, merge). */
  actorUserId?: string;
}

type ContactRow = Record<string, any> & { contact_name_id: string; client_id?: string | null };

function ctxFor(tenant: string, occurredAt: string, actorUserId?: string) {
  return {
    tenantId: tenant,
    occurredAt,
    ...(actorUserId ? { actor: { actorType: 'USER' as const, actorUserId } } : {}),
  };
}

export function queueContactCreated(
  trx: Knex.Transaction,
  tenant: string,
  contact: ContactRow,
  options: ContactEventOptions = {}
): void {
  const created = contact.created_at ? new Date(contact.created_at) : new Date();
  const occurredAt = (Number.isNaN(created.getTime()) ? new Date() : created).toISOString();
  registerAfterCommit(
    trx,
    () =>
      publishWorkflowEvent({
        eventType: 'CONTACT_CREATED',
        payload: buildContactCreatedPayload({
          contactId: contact.contact_name_id,
          clientId: contact.client_id,
          fullName: contact.full_name,
          email: contact.email || undefined,
          primaryEmailCanonicalType: contact.primary_email_canonical_type ?? null,
          primaryEmailCustomTypeId: contact.primary_email_custom_type_id ?? null,
          primaryEmailType: contact.primary_email_type ?? null,
          additionalEmailAddresses: contact.additional_email_addresses ?? [],
          phoneNumbers: contact.phone_numbers,
          defaultPhoneNumber: contact.default_phone_number || undefined,
          defaultPhoneType: contact.default_phone_type || undefined,
          createdByUserId: options.actorUserId,
          createdAt: occurredAt,
        }),
        ctx: ctxFor(tenant, occurredAt, options.actorUserId),
        idempotencyKey: `contact_created:${contact.contact_name_id}`,
      }),
    `CONTACT_CREATED contact=${contact.contact_name_id}`
  );
}

/**
 * Publishes CONTACT_UPDATED when any of `updatedFieldKeys` (snake_case column names) actually
 * changed between `before` and `after`, and CONTACT_ARCHIVED on the false -> true `is_inactive`
 * flip. Un-archiving has no dedicated domain event; it is reported by the UPDATED event
 * (`is_inactive` in the changed fields).
 */
export function queueContactUpdated(
  trx: Knex.Transaction,
  tenant: string,
  before: ContactRow,
  after: ContactRow,
  updatedFieldKeys: string[],
  options: ContactEventOptions = {}
): void {
  const occurredAt = new Date().toISOString();
  const contactId = after.contact_name_id;
  const clientId = after.client_id ?? before.client_id;
  const payload = buildContactUpdatedPayload({
    contactId,
    clientId,
    before,
    after,
    updatedFieldKeys,
    updatedByUserId: options.actorUserId,
    updatedAt: occurredAt,
  });

  if ((payload as { updatedFields?: string[] }).updatedFields?.length) {
    registerAfterCommit(
      trx,
      () =>
        publishWorkflowEvent({
          eventType: 'CONTACT_UPDATED',
          payload,
          ctx: ctxFor(tenant, occurredAt, options.actorUserId),
          idempotencyKey: `contact_updated:${contactId}:${occurredAt}`,
        }),
      `CONTACT_UPDATED contact=${contactId}`
    );
  }

  if (!before.is_inactive && after.is_inactive) {
    queueContactArchived(trx, tenant, { contactId, clientId }, options, occurredAt);
  }
}

export function queueContactArchived(
  trx: Knex.Transaction,
  tenant: string,
  contact: { contactId: string; clientId?: string | null },
  options: ContactEventOptions = {},
  occurredAt: string = new Date().toISOString()
): void {
  registerAfterCommit(
    trx,
    () =>
      publishWorkflowEvent({
        eventType: 'CONTACT_ARCHIVED',
        payload: buildContactArchivedPayload({
          contactId: contact.contactId,
          clientId: contact.clientId,
          archivedByUserId: options.actorUserId,
          archivedAt: occurredAt,
        }),
        ctx: ctxFor(tenant, occurredAt, options.actorUserId),
        idempotencyKey: `contact_archived:${contact.contactId}:${occurredAt}`,
      }),
    `CONTACT_ARCHIVED contact=${contact.contactId}`
  );
}

/**
 * Runs `mutate` and queues CONTACT_UPDATED (plus CONTACT_ARCHIVED on the false -> true flip) for
 * each contact whose `updatedFieldKeys` columns actually changed. For writers that update rows
 * with raw statements (sync jobs, bulk deactivations) instead of going through ContactModel.
 * `updatedFieldKeys` must list only public contact columns - internal sync bookkeeping such as
 * last_entra_sync_at is deliberately left out so periodic syncs do not emit noise.
 */
export async function trackContactUpdates<T>(
  trx: Knex.Transaction,
  tenant: string,
  contactIds: string[],
  updatedFieldKeys: string[],
  mutate: () => Promise<T>,
  options: ContactEventOptions = {}
): Promise<T> {
  const before = new Map<string, ContactRow>();
  for (const id of contactIds) {
    const row = await ContactModel.getContactById(id, tenant, trx);
    if (row) before.set(id, row as unknown as ContactRow);
  }
  const result = await mutate();
  for (const [id, beforeRow] of before) {
    const afterRow = await ContactModel.getContactById(id, tenant, trx);
    if (afterRow) {
      queueContactUpdated(trx, tenant, beforeRow, afterRow as unknown as ContactRow, updatedFieldKeys, options);
    }
  }
  return result;
}
