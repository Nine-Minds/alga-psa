import { randomUUID } from 'crypto';
import { createTenantKnex, runWithTenant } from '@/lib/db';
import { ContactModel } from '@alga-psa/shared/models/contactModel';
import type { Knex } from 'knex';
import type { EntraSyncUser } from './sync/types';
import type { EntraContactMatchCandidate } from './sync/contactMatcher';
import { upsertEntraContactLinkActive } from './sync/contactLinkRepository';

export interface QueueAmbiguousEntraMatchInput {
  tenantId: string;
  managedTenantId?: string | null;
  clientId?: string | null;
  user: EntraSyncUser;
  candidates: EntraContactMatchCandidate[];
}

export interface EntraReconciliationQueueItem {
  queueItemId: string;
  managedTenantId: string | null;
  clientId: string | null;
  entraTenantId: string;
  entraObjectId: string;
  userPrincipalName: string | null;
  displayName: string | null;
  email: string | null;
  candidateContacts: Array<Record<string, unknown>>;
  status: string;
  createdAt: string;
}

interface QueueRow {
  queue_item_id: string;
  managed_tenant_id: string | null;
  client_id: string | null;
  entra_tenant_id: string;
  entra_object_id: string;
  user_principal_name: string | null;
  display_name: string | null;
  email: string | null;
  status: string;
}

function serializeCandidates(candidates: EntraContactMatchCandidate[]): Array<Record<string, unknown>> {
  return candidates.map((candidate) => ({
    contactNameId: candidate.contactNameId,
    clientId: candidate.clientId,
    email: candidate.email,
    fullName: candidate.fullName,
    isInactive: candidate.isInactive,
  }));
}

export async function queueAmbiguousEntraMatch(
  input: QueueAmbiguousEntraMatchInput
): Promise<{ queueItemId: string }> {
  return runWithTenant(input.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const now = knex.fn.now();
    const payload = {
      reason: 'multiple_email_matches',
      candidateCount: input.candidates.length,
    };
    const serializedCandidates = serializeCandidates(input.candidates);

    const existing = await knex('entra_contact_reconciliation_queue')
      .where({
        tenant: input.tenantId,
        entra_tenant_id: input.user.entraTenantId,
        entra_object_id: input.user.entraObjectId,
        status: 'open',
      })
      .first(['queue_item_id']);

    if (existing?.queue_item_id) {
      await knex('entra_contact_reconciliation_queue')
        .where({
          tenant: input.tenantId,
          queue_item_id: existing.queue_item_id,
        })
        .update({
          managed_tenant_id: input.managedTenantId || null,
          client_id: input.clientId || null,
          user_principal_name: input.user.userPrincipalName,
          display_name: input.user.displayName,
          email: input.user.email,
          candidate_contacts: knex.raw('?::jsonb', [JSON.stringify(serializedCandidates)]),
          payload: knex.raw('?::jsonb', [JSON.stringify(payload)]),
          updated_at: now,
        });

      return { queueItemId: String(existing.queue_item_id) };
    }

    const queueItemId = randomUUID();
    await knex('entra_contact_reconciliation_queue').insert({
      tenant: input.tenantId,
      queue_item_id: queueItemId,
      managed_tenant_id: input.managedTenantId || null,
      client_id: input.clientId || null,
      entra_tenant_id: input.user.entraTenantId,
      entra_object_id: input.user.entraObjectId,
      user_principal_name: input.user.userPrincipalName,
      display_name: input.user.displayName,
      email: input.user.email,
      candidate_contacts: knex.raw('?::jsonb', [JSON.stringify(serializedCandidates)]),
      status: 'open',
      payload: knex.raw('?::jsonb', [JSON.stringify(payload)]),
      created_at: now,
      updated_at: now,
    });

    return { queueItemId };
  });
}

export async function listOpenEntraReconciliationQueue(
  tenantId: string,
  limit = 50
): Promise<EntraReconciliationQueueItem[]> {
  return runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    const rows = await knex('entra_contact_reconciliation_queue')
      .where({ tenant: tenantId, status: 'open' })
      .orderBy('created_at', 'desc')
      .limit(Math.max(1, Math.min(200, Math.floor(limit || 50))))
      .select('*');

    return rows.map((row: any) => ({
      queueItemId: String(row.queue_item_id),
      managedTenantId: row.managed_tenant_id ? String(row.managed_tenant_id) : null,
      clientId: row.client_id ? String(row.client_id) : null,
      entraTenantId: String(row.entra_tenant_id),
      entraObjectId: String(row.entra_object_id),
      userPrincipalName: row.user_principal_name ? String(row.user_principal_name) : null,
      displayName: row.display_name ? String(row.display_name) : null,
      email: row.email ? String(row.email) : null,
      candidateContacts: Array.isArray(row.candidate_contacts)
        ? row.candidate_contacts
        : [],
      status: String(row.status),
      createdAt:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }));
  });
}

async function loadOpenQueueItem(
  trx: Knex.Transaction,
  tenantId: string,
  queueItemId: string
): Promise<QueueRow> {
  const queueRow = await trx('entra_contact_reconciliation_queue')
    .where({
      tenant: tenantId,
      queue_item_id: queueItemId,
      status: 'open',
    })
    .first();

  if (!queueRow) {
    throw new Error('Reconciliation queue item not found or already resolved.');
  }

  return queueRow as QueueRow;
}

function queueRowToSyncUser(queueRow: QueueRow): EntraSyncUser {
  return {
    entraTenantId: queueRow.entra_tenant_id,
    entraObjectId: queueRow.entra_object_id,
    userPrincipalName: queueRow.user_principal_name || null,
    email: queueRow.email || queueRow.user_principal_name || null,
    displayName: queueRow.display_name || null,
    givenName: null,
    surname: null,
    accountEnabled: true,
    jobTitle: null,
    mobilePhone: null,
    businessPhones: [],
    raw: {},
  };
}

async function resolveQueueItem(
  trx: Knex.Transaction,
  tenantId: string,
  queueItemId: string,
  contactNameId: string,
  resolutionAction: 'link_existing' | 'create_new',
  resolvedBy?: string
): Promise<void> {
  const now = trx.fn.now();
  await trx('entra_contact_reconciliation_queue')
    .where({
      tenant: tenantId,
      queue_item_id: queueItemId,
    })
    .update({
      status: 'resolved',
      resolution_action: resolutionAction,
      resolved_contact_id: contactNameId,
      resolved_by: resolvedBy || null,
      resolved_at: now,
      updated_at: now,
    });
}

export async function resolveEntraQueueToExistingContact(input: {
  tenantId: string;
  queueItemId: string;
  contactNameId: string;
  resolvedBy?: string;
}): Promise<{ queueItemId: string; contactNameId: string }> {
  return runWithTenant(input.tenantId, async () => {
    const { knex } = await createTenantKnex();

    return knex.transaction(async (trx) => {
      const queueRow = await loadOpenQueueItem(trx, input.tenantId, input.queueItemId);
      const contactRow = await trx('contacts')
        .where({
          tenant: input.tenantId,
          contact_name_id: input.contactNameId,
        })
        .first(['contact_name_id', 'client_id']);

      if (!contactRow?.contact_name_id) {
        throw new Error('Contact does not exist for this tenant.');
      }

      if (queueRow.client_id && contactRow.client_id && String(contactRow.client_id) !== String(queueRow.client_id)) {
        throw new Error('Queue item and contact belong to different clients.');
      }

      const syncUser = queueRowToSyncUser(queueRow);
      await upsertEntraContactLinkActive(trx, {
        tenantId: input.tenantId,
        clientId: queueRow.client_id ? String(queueRow.client_id) : contactRow.client_id ? String(contactRow.client_id) : null,
        contactNameId: String(contactRow.contact_name_id),
        user: syncUser,
      });

      await resolveQueueItem(
        trx,
        input.tenantId,
        input.queueItemId,
        String(contactRow.contact_name_id),
        'link_existing',
        input.resolvedBy
      );

      return {
        queueItemId: input.queueItemId,
        contactNameId: String(contactRow.contact_name_id),
      };
    });
  });
}

export async function resolveEntraQueueToNewContact(input: {
  tenantId: string;
  queueItemId: string;
  resolvedBy?: string;
}): Promise<{ queueItemId: string; contactNameId: string }> {
  return runWithTenant(input.tenantId, async () => {
    const { knex } = await createTenantKnex();

    return knex.transaction(async (trx) => {
      const queueRow = await loadOpenQueueItem(trx, input.tenantId, input.queueItemId);
      if (!queueRow.client_id) {
        throw new Error('Queue item does not have an associated client for contact creation.');
      }

      const email = (queueRow.email || queueRow.user_principal_name || '').trim().toLowerCase();
      if (!email) {
        throw new Error('Queue item does not include a valid email identity for contact creation.');
      }

      const created = await ContactModel.createContact(
        {
          full_name: queueRow.display_name || email.split('@')[0] || 'Entra Contact',
          email,
          client_id: String(queueRow.client_id),
          is_inactive: false,
        },
        input.tenantId,
        trx
      );

      await upsertEntraContactLinkActive(trx, {
        tenantId: input.tenantId,
        clientId: String(queueRow.client_id),
        contactNameId: String(created.contact_name_id),
        user: queueRowToSyncUser(queueRow),
      });

      await resolveQueueItem(
        trx,
        input.tenantId,
        input.queueItemId,
        String(created.contact_name_id),
        'create_new',
        input.resolvedBy
      );

      return {
        queueItemId: input.queueItemId,
        contactNameId: String(created.contact_name_id),
      };
    });
  });
}
