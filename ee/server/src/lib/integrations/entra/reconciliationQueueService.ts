import { randomUUID } from 'crypto';
import { createTenantKnex, runWithTenant } from '@/lib/db';
import type { EntraSyncUser } from './sync/types';
import type { EntraContactMatchCandidate } from './sync/contactMatcher';

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
