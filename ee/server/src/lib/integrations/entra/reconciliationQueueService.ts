import { randomUUID } from 'crypto';
import { createTenantKnex, runWithTenant } from '@/lib/db';
import { ContactModel } from '@alga-psa/shared/models/contactModel';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { queueContactCreated } from '@alga-psa/shared/lib/contacts/contactEvents';
import type { Knex } from 'knex';
import type { EntraSyncUser } from './sync/types';
import type { EntraContactMatchCandidate } from './sync/contactMatcher';
import type { ContactEmailOwner } from '@alga-psa/shared/models/contactEmailOwnership';
import { upsertEntraContactLinkActive } from './sync/contactLinkRepository';

export interface QueueAmbiguousEntraMatchInput {
  tenantId: string;
  managedTenantId?: string | null;
  clientId?: string | null;
  user: EntraSyncUser;
  candidates: EntraContactMatchCandidate[];
}

export type EntraQueueReason = 'multiple_email_matches' | 'email_owned_by_other_client';

/** The contact (and client) that already owns the email a queued identity would have been created with. */
export interface EntraQueueOwner {
  contactNameId: string;
  fullName: string;
  clientId: string | null;
  clientName: string | null;
  kind: 'primary' | 'additional';
  isInactive: boolean;
  /** The matched address (normalized). */
  email: string | null;
}

export interface QueueEntraEmailConflictInput {
  tenantId: string;
  managedTenantId?: string | null;
  clientId?: string | null;
  user: EntraSyncUser;
  owner: ContactEmailOwner;
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
  /** Why the sync stopped for this identity. */
  reason: EntraQueueReason;
  /** Set for `email_owned_by_other_client`: the contact that holds the address. */
  owner: EntraQueueOwner | null;
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
  payload?: { reason?: unknown } | null;
  candidate_contacts?: unknown;
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
  return queueEntraReviewItem({
    tenantId: input.tenantId,
    managedTenantId: input.managedTenantId,
    clientId: input.clientId,
    user: input.user,
    payload: { reason: 'multiple_email_matches', candidateCount: input.candidates.length },
    serializedCandidates: serializeCandidates(input.candidates),
  });
}

/**
 * The address this identity would be created with already belongs to a contact at
 * another client (or at none). The sync never links across that boundary on its own:
 * the owner is recorded here and an operator decides (link anyway, or dismiss).
 */
export async function queueEntraEmailConflict(
  input: QueueEntraEmailConflictInput
): Promise<{ queueItemId: string }> {
  const { owner } = input;
  return queueEntraReviewItem({
    tenantId: input.tenantId,
    managedTenantId: input.managedTenantId,
    clientId: input.clientId,
    user: input.user,
    payload: { reason: 'email_owned_by_other_client', candidateCount: 1, ownerKind: owner.kind },
    serializedCandidates: [{
      contactNameId: owner.contactNameId,
      clientId: owner.clientId,
      clientName: owner.clientName,
      email: owner.email,
      fullName: owner.fullName,
      isInactive: owner.isInactive,
      kind: owner.kind,
    }],
  });
}

interface QueueEntraReviewItemInput {
  tenantId: string;
  managedTenantId?: string | null;
  clientId?: string | null;
  user: EntraSyncUser;
  payload: Record<string, unknown>;
  serializedCandidates: Array<Record<string, unknown>>;
}

async function queueEntraReviewItem(
  input: QueueEntraReviewItemInput
): Promise<{ queueItemId: string }> {
  return runWithTenant(input.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, input.tenantId);
    const now = knex.fn.now();
    const payload = input.payload;
    const serializedCandidates = input.serializedCandidates;

    const existing = await db.table('entra_contact_reconciliation_queue')
      .where({
        entra_tenant_id: input.user.entraTenantId,
        entra_object_id: input.user.entraObjectId,
        status: 'open',
      })
      .first(['queue_item_id']);

    if (existing?.queue_item_id) {
      await db.table('entra_contact_reconciliation_queue')
        .where({
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

    // A dismissed identity stays dismissed: the operator has already said this
    // ambiguity is not worth their attention, and re-queueing it every sync is
    // how a review queue becomes a screen nobody opens.
    const dismissed = await db.table('entra_contact_reconciliation_queue')
      .where({
        entra_tenant_id: input.user.entraTenantId,
        entra_object_id: input.user.entraObjectId,
        status: 'dismissed',
      })
      .first(['queue_item_id']);

    if (dismissed?.queue_item_id) {
      return { queueItemId: String(dismissed.queue_item_id) };
    }

    const queueItemId = randomUUID();
    await db.table('entra_contact_reconciliation_queue').insert({
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

export interface DismissEntraQueueItemInput {
  tenantId: string;
  queueItemId: string;
  userId?: string | null;
  reason?: string | null;
}

/**
 * Dismiss an ambiguous match. Until now items could only accumulate, so the
 * queue only ever grew and stopped being worth opening. The resolution is
 * recorded on the row — who dismissed it, when, and why — so a dismissal is
 * auditable rather than a disappearance.
 */
export async function dismissEntraQueueItem(
  input: DismissEntraQueueItemInput
): Promise<{ queueItemId: string; status: string }> {
  return runWithTenant(input.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, input.tenantId);
    const now = knex.fn.now();

    const existing = await db.table('entra_contact_reconciliation_queue')
      .where({ queue_item_id: input.queueItemId })
      .first(['queue_item_id', 'status']);

    if (!existing?.queue_item_id) {
      throw new Error('Queue item does not exist for this tenant.');
    }

    if (String(existing.status) !== 'open') {
      return { queueItemId: input.queueItemId, status: String(existing.status) };
    }

    await db.table('entra_contact_reconciliation_queue')
      .where({ queue_item_id: input.queueItemId })
      .update({
        status: 'dismissed',
        resolution_action: 'dismissed',
        resolved_by: input.userId || null,
        resolved_at: now,
        payload: knex.raw('?::jsonb', [
          JSON.stringify({
            reason: 'dismissed_by_operator',
            note: input.reason || null,
          }),
        ]),
        updated_at: now,
      });

    return { queueItemId: input.queueItemId, status: 'dismissed' };
  });
}

function queueReasonAndOwner(row: any): { reason: EntraQueueReason; owner: EntraQueueOwner | null } {
  const reason: EntraQueueReason =
    row.payload?.reason === 'email_owned_by_other_client' ? 'email_owned_by_other_client' : 'multiple_email_matches';
  const first = Array.isArray(row.candidate_contacts) ? row.candidate_contacts[0] : null;
  if (reason !== 'email_owned_by_other_client' || !first?.contactNameId) {
    return { reason, owner: null };
  }
  return {
    reason,
    owner: {
      contactNameId: String(first.contactNameId),
      fullName: first.fullName ? String(first.fullName) : '',
      clientId: first.clientId ? String(first.clientId) : null,
      clientName: first.clientName ? String(first.clientName) : null,
      kind: first.kind === 'additional' ? 'additional' : 'primary',
      isInactive: Boolean(first.isInactive),
      email: first.email ? String(first.email) : null,
    },
  };
}

export async function listOpenEntraReconciliationQueue(
  tenantId: string,
  limit = 50
): Promise<EntraReconciliationQueueItem[]> {
  return runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    const rows = await tenantDb(knex, tenantId).table('entra_contact_reconciliation_queue')
      .where({ status: 'open' })
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
      ...queueReasonAndOwner(row),
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
  const queueRow = await tenantDb(trx, tenantId).table('entra_contact_reconciliation_queue')
    .where({
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
    userType: null,
    assignedLicenseCount: null,
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
  await tenantDb(trx, tenantId).table('entra_contact_reconciliation_queue')
    .where({
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
      const contactRow = await tenantDb(trx, input.tenantId).table('contacts')
        .where({
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

    return withTransaction(knex, async (trx) => {
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
      queueContactCreated(trx, input.tenantId, created as any);

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

export interface LinkEntraQueueItemAnywayInput {
  tenantId: string;
  queueItemId: string;
  /** The operator making the decision; recorded on the item and on the link. */
  resolvedBy?: string;
  note?: string | null;
}

/**
 * The operator's explicit "this person really is that contact": links an identity
 * queued as `email_owned_by_other_client` to the owning contact even though it sits at
 * another client. It is the only path that links across clients, it never runs from a
 * sync, and it leaves an audit trail on both the link and the queue item.
 */
export async function resolveEntraQueueLinkAnyway(
  input: LinkEntraQueueItemAnywayInput
): Promise<{ queueItemId: string; contactNameId: string }> {
  return runWithTenant(input.tenantId, async () => {
    const { knex } = await createTenantKnex();

    return withTransaction(knex, async (trx) => {
      const queueRow = await loadOpenQueueItem(trx, input.tenantId, input.queueItemId);
      const { reason, owner } = queueReasonAndOwner(queueRow);
      if (reason !== 'email_owned_by_other_client' || !owner) {
        throw new Error('Only items queued because the email belongs to another contact can be linked anyway.');
      }

      const contactRow = await tenantDb(trx, input.tenantId).table('contacts')
        .where({ contact_name_id: owner.contactNameId })
        .first(['contact_name_id', 'client_id']);
      if (!contactRow?.contact_name_id) {
        throw new Error('Contact does not exist for this tenant.');
      }

      const decidedAt = new Date().toISOString();
      const audit = {
        decision: 'link_anyway',
        decidedBy: input.resolvedBy || null,
        decidedAt,
        note: input.note || null,
        queueItemId: input.queueItemId,
        ownerContactNameId: owner.contactNameId,
        ownerClientId: contactRow.client_id ? String(contactRow.client_id) : null,
        syncedClientId: queueRow.client_id ? String(queueRow.client_id) : null,
      };

      await upsertEntraContactLinkActive(trx, {
        tenantId: input.tenantId,
        clientId: queueRow.client_id ? String(queueRow.client_id) : contactRow.client_id ? String(contactRow.client_id) : null,
        contactNameId: String(contactRow.contact_name_id),
        user: queueRowToSyncUser(queueRow),
        metadata: { operatorDecision: audit },
      });

      const now = trx.fn.now();
      await tenantDb(trx, input.tenantId).table('entra_contact_reconciliation_queue')
        .where({ queue_item_id: input.queueItemId })
        .update({
          status: 'resolved',
          resolution_action: 'link_anyway',
          resolved_contact_id: String(contactRow.contact_name_id),
          resolved_by: input.resolvedBy || null,
          resolved_at: now,
          payload: trx.raw('?::jsonb', [JSON.stringify({ reason: 'linked_anyway_by_operator', ...audit })]),
          updated_at: now,
        });

      return { queueItemId: input.queueItemId, contactNameId: String(contactRow.contact_name_id) };
    });
  });
}
