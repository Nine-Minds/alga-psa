'use server';

import { withAuth } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { CoManagedDelegationError, CoManagedPolicyError, listCoManagedLiveSponsoredRelationships, executeCoManagedDelegatedCommand, getCoManagedDelegatedScreen, isCoManagedSharedWorkError,
  listCoManagedDelegatedWorkspaces, revokeCoManagedDelegatedGrant, saveCoManagedDelegatedGrant, searchCoManagedDelegatedOptions,
  type CoManagedDelegatedCommand, type CoManagedDelegatedGrantInput, type CoManagedDelegatedOperation } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { resolveCoManagedRelationshipTarget } from '../co-managed/relationshipTarget';

// Delegated administration acts on workspaces that already exist, so every action gates on `serves`.
// The library answers every refusal other than a named delegation outcome as the same opaque error.

type Refusal = { ok: false; errorCode: 'NOT_AVAILABLE' | 'CO_MANAGED_DELEGATION_REVOKED' | 'CO_MANAGED_DELEGATION_TARGET_CHANGED' | 'CHANGED' };
function refusal(error: unknown): Refusal {
  if (error instanceof CoManagedDelegationError) return { ok: false, errorCode: error.code };
  if (isCoManagedSharedWorkError(error)) return { ok: false, errorCode: 'NOT_AVAILABLE' };
  // Stale-revision refusals are plain errors from the library; name them so the screen can ask for a refresh.
  if (error instanceof Error && /changed; refresh/i.test(error.message)) return { ok: false, errorCode: 'CHANGED' };
  throw error;
}

/** The gate runs inside the withAuth callback so the tenant handed to the adapter is the session's (the entry-point contract checks this). */
function withCoManagedServes<A extends unknown[], R>(work: (user: IUserWithRoles, ctx: { tenant: string }, ...args: A) => Promise<R>) {
  return withAuth(async (user, { tenant }, ...args: A) => {
    await requireCapabilityForAction('co-managed', tenant, 'serves');
    return work(user, { tenant }, ...args);
  });
}

async function setup(user: { user_id: string; user_type?: string }, tenant: string, relationshipId: string) {
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  const { customerTenant } = await resolveCoManagedRelationshipTarget(knex, tenant, relationshipId);
  return { knex, actor, target: { customerTenant, relationshipId } };
}

/** Workspaces with delegated administration for the signed-in user, keyed by relationship, with display names only. */
export const listCoManagedAdministrationWorkspacesAction = withAuth(async (user, { tenant }) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  const home = tenantDb(knex, tenant);
  const own = await home.table('tenants').first('product_code');
  if (own?.product_code === 'co_managed') {
    // The customer administers its own relationships: one entry per live sponsor.
    const rows = await home.table('co_management_relationships').where({ state: 'active' }).whereNull('ended_at').select('relationship_id', 'sponsor_tenant');
    const result: { relationshipId: string; name: string; side: 'customer'; effective: boolean; delegated: boolean }[] = [];
    for (const row of rows) {
      const sponsor = await tenantDb(knex, row.sponsor_tenant).table('tenants').first('client_name');
      result.push({ relationshipId: row.relationship_id, name: sponsor?.client_name ?? '', side: 'customer', effective: true, delegated: true });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }
  // Sponsor: Effective access lists every live sponsored relationship the user may read (co_management:read|manage, checked
  // server-side against current rows); the delegated section is filtered per grant. A user with only delegated grants still
  // sees those workspaces, without the Effective access section.
  const result: { relationshipId: string; name: string; side: 'sponsor'; effective: boolean; delegated: boolean }[] = [];
  const byRelationship = new Map<string, (typeof result)[number]>();
  let live: Awaited<ReturnType<typeof listCoManagedLiveSponsoredRelationships>> = [];
  try { live = await listCoManagedLiveSponsoredRelationships(knex, actor); }
  catch (error) { if (!(error instanceof CoManagedPolicyError)) throw error; }
  for (const item of live) {
    const entry = { relationshipId: item.relationshipId, name: item.name, side: 'sponsor' as const, effective: true, delegated: false };
    byRelationship.set(item.relationshipId, entry); result.push(entry);
  }
  for (const workspace of await listCoManagedDelegatedWorkspaces(knex, actor)) {
    const operation = await home.table('co_managed_provisioning_operations').where({ operation_id: workspace.operationId }).first('relationship_id');
    if (!operation?.relationship_id) continue;
    const existing = byRelationship.get(operation.relationship_id);
    if (existing) existing.delegated = true;
    else result.push({ relationshipId: operation.relationship_id, name: workspace.name, side: 'sponsor', effective: false, delegated: true });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
});

export const getCoManagedDelegatedScreenAction = withCoManagedServes(async (user, { tenant }, relationshipId: string) => {
  try {
    const { knex, actor, target } = await setup(user, tenant, relationshipId);
    return { ok: true as const, screen: await getCoManagedDelegatedScreen(knex, actor, target) };
  } catch (error) { return refusal(error); }
});

export const saveCoManagedDelegatedGrantAction = withCoManagedServes(async (user, { tenant }, relationshipId: string,
  expectedRevision: number, input: CoManagedDelegatedGrantInput) => {
  try {
    const { knex, actor, target } = await setup(user, tenant, relationshipId);
    return { ok: true as const, ...await saveCoManagedDelegatedGrant(knex, actor, target, expectedRevision, input) };
  } catch (error) { return refusal(error); }
});

export const revokeCoManagedDelegatedGrantAction = withCoManagedServes(async (user, { tenant }, relationshipId: string,
  expectedRevision: number, grantId: string) => {
  try {
    const { knex, actor, target } = await setup(user, tenant, relationshipId);
    return { ok: true as const, ...await revokeCoManagedDelegatedGrant(knex, actor, target, expectedRevision, grantId) };
  } catch (error) { return refusal(error); }
});

export const searchCoManagedDelegatedOptionsAction = withCoManagedServes(async (user, { tenant }, relationshipId: string,
  input: { kind: 'principal' | CoManagedDelegatedOperation; search?: string; page?: number }) => {
  try {
    const { knex, actor, target } = await setup(user, tenant, relationshipId);
    return { ok: true as const, ...await searchCoManagedDelegatedOptions(knex, actor, target, input) };
  } catch (error) { return refusal(error); }
});

export const executeCoManagedDelegatedCommandAction = withCoManagedServes(async (user, { tenant }, relationshipId: string, input: CoManagedDelegatedCommand) => {
  try {
    const { knex, actor, target } = await setup(user, tenant, relationshipId);
    return { ok: true as const, ...await executeCoManagedDelegatedCommand(knex, actor, target, input) };
  } catch (error) { return refusal(error); }
});
