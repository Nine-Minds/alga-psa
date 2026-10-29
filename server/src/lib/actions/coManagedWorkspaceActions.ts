'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { countCoManagedCommittedSeats } from '@alga-psa/licensing';
import { isCoManagedUuid, resolveCoManagedManagementTarget } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { COMANAGED_HISTORY_LIMIT } from '../co-managed/relationshipHistory';

// Everything here shows state that already exists, so each gates on `serves`
// (sticky), never `admits`: an ended or entitlement-less relationship must stay
// readable. No user id, email or event id leaves the server.

export interface CoManagedHistoryEntry {
  eventType: string;
  revision: number;
  occurredAt: string;
  /** `you` is the viewing side's own workspace; `other` carries the counterpart's name. */
  party: 'you' | 'other';
  partyName: string | null;
}

export interface CoManagedRelationshipHistory {
  entries: CoManagedHistoryEntry[];
}

export type CoManagedWorkspaceState =
  | { kind: 'none' }
  | { kind: 'live'; sponsorName: string | null; seats: number | null; usedSeats: number | null; state: string; revision: number }
  | { kind: 'ended'; endedAt: string; sponsorName: string | null };

/** Newest-first relationship events, at most 50. A sponsor passes the client (and
 * optionally the relationship); a customer workspace reads its own relationship. */
export const getCoManagedRelationshipHistory = withAuth(async (user, { tenant },
  input: { clientId?: string; relationshipId?: string } = {}): Promise<CoManagedRelationshipHistory> => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  if (user.user_type !== 'internal') throw new Error('Permission denied');
  const { knex } = await createTenantKnex(tenant);
  const owner = await tenantDb(knex, tenant).table('tenants').first('product_code');
  if (owner?.product_code === 'co_managed') {
    const latest = await tenantDb(knex, tenant).table('co_management_relationships')
      .orderBy('created_at', 'desc').first('relationship_id', 'sponsor_tenant');
    if (!latest) return { entries: [] };
    return readEvents(tenant, latest.relationship_id as string, tenant,
      await nameOf(tenantDb(knex, latest.sponsor_tenant as string)), knex);
  }
  if (!input.clientId || !isCoManagedUuid(input.clientId) || !await hasPermission(user, 'co_management', 'read')) throw new Error('Permission denied');
  const actor = await coManagedBrowserActor(user, tenant);
  const resolution = await resolveCoManagedManagementTarget(knex, actor,
    { kind: 'sponsor-client', clientId: input.clientId, relationshipId: input.relationshipId });
  if (resolution.kind !== 'resolved') return { entries: [] };
  const { target } = resolution;
  return readEvents(target.customerTenant, target.relationshipId, tenant,
    await nameOf(tenantDb(knex, target.customerTenant)), knex);
});

/** The customer workspace's own relationship: live (sponsor, seats) or ended. */
export const getCoManagedWorkspaceState = withAuth(async (user, { tenant }): Promise<CoManagedWorkspaceState> => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  if (user.user_type !== 'internal') throw new Error('Permission denied');
  const { knex } = await createTenantKnex(tenant);
  const home = tenantDb(knex, tenant);
  if ((await home.table('tenants').first('product_code'))?.product_code !== 'co_managed') throw new Error('Permission denied');
  const relationship = await home.table('co_management_relationships')
    .orderBy('created_at', 'desc').first('relationship_id', 'sponsor_tenant', 'state', 'revision', 'ended_at');
  if (!relationship) return { kind: 'none' };
  const sponsor = tenantDb(knex, relationship.sponsor_tenant as string);
  const sponsorName = await nameOf(sponsor);
  if (relationship.ended_at || relationship.state === 'terminated') {
    return { kind: 'ended', endedAt: new Date(relationship.ended_at as string | Date).toISOString(), sponsorName };
  }
  const allocation = await sponsor.table('co_managed_allocations')
    .where({ customer_tenant: tenant, relationship_id: relationship.relationship_id }).first('seats');
  const usedSeats = relationship.state === 'active'
    ? await knex.transaction((trx) => countCoManagedCommittedSeats(trx, tenant)) : null;
  return { kind: 'live', sponsorName, seats: allocation ? Number(allocation.seats) : null, usedSeats,
    state: relationship.state as string, revision: Number(relationship.revision) };
});

// Helpers sit below the exported actions: each action calls its capability adapter
// before any database work (capabilityEntryPoints Rule A is order-sensitive).
async function nameOf(db: ReturnType<typeof tenantDb>): Promise<string | null> {
  const row = await db.table('tenants').first('client_name');
  return (row?.client_name as string | undefined) ?? null;
}

async function readEvents(customerTenant: string, relationshipId: string, viewerTenant: string, otherName: string | null,
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex']): Promise<CoManagedRelationshipHistory> {
  const rows = await tenantDb(knex, customerTenant).table('co_management_relationship_events')
    .where({ relationship_id: relationshipId })
    .orderBy([{ column: 'revision', order: 'desc' }, { column: 'created_at', order: 'desc' }])
    .limit(COMANAGED_HISTORY_LIMIT)
    .select('event_type', 'revision', 'created_at', 'actor_tenant');
  return {
    entries: rows.map((row: any) => ({
      eventType: row.event_type as string,
      revision: Number(row.revision),
      occurredAt: new Date(row.created_at).toISOString(),
      party: row.actor_tenant === viewerTenant ? 'you' as const : 'other' as const,
      partyName: row.actor_tenant === viewerTenant ? null : otherName,
    })),
  };
}
