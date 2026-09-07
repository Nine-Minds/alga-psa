'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { getCoManagedOperationalState } from '@alga-psa/licensing';
import { getCoManagedCollaborationPolicy, replaceCoManagedCustomerScope, replaceCoManagedStaffAssignments,
  CoManagedPolicyError, type CoManagedCustomerScope, type CoManagedStaffAssignment } from '@alga-psa/co-managed';
import type { Knex } from 'knex';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Customer identity comes from home; MSP discovery comes from its own operation. */
async function resolveTarget(db: Knex, tenant: string, operationId?: string) {
  const home = tenantDb(db, tenant);
  const owner = await home.table('tenants').first('product_code');
  if (owner?.product_code === 'co_managed') {
    if (operationId !== undefined) throw new CoManagedPolicyError('FORBIDDEN');
    const relationship = await home.table('co_management_relationships').whereNull('ended_at').first('relationship_id', 'sponsor_tenant');
    if (!relationship) throw new CoManagedPolicyError('FORBIDDEN');
    return { side: 'customer' as const, target: { customerTenant: tenant, relationshipId: relationship.relationship_id as string },
      otherTenant: relationship.sponsor_tenant as string };
  }
  if (owner?.product_code !== 'psa' || typeof operationId !== 'string' || !uuid.test(operationId)) throw new CoManagedPolicyError('FORBIDDEN');
  const operation = await home.table('co_managed_provisioning_operations').where('operation_id', operationId)
    .first('customer_tenant', 'relationship_id');
  if (!operation) throw new CoManagedPolicyError('FORBIDDEN');
  return { side: 'sponsor' as const, target: { customerTenant: operation.customer_tenant as string, relationshipId: operation.relationship_id as string },
    otherTenant: operation.customer_tenant as string };
}

export interface CoManagedPolicyOption { id: string; name: string; inactive?: boolean }
export type CoManagedPolicyOptionKind = 'board' | 'project' | 'user' | 'team';

function optionQuery(db: Knex, tenant: string, kind: CoManagedPolicyOptionKind) {
  const table = { board: 'boards', project: 'projects', user: 'users', team: 'teams' }[kind];
  const id = { board: 'board_id', project: 'project_id', user: 'user_id', team: 'team_id' }[kind];
  const name = { board: 'board_name', project: 'project_name', user: 'username', team: 'team_name' }[kind];
  const query = tenantDb(db, tenant).table(table).select({ id, name });
  if (kind === 'user') query.select('first_name', 'last_name', 'is_inactive');
  if (kind === 'board') query.select('is_inactive');
  return { query, id, name };
}
function toOption(row: any): CoManagedPolicyOption {
  return { id: row.id, name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.name,
    ...(row.is_inactive !== undefined ? { inactive: Boolean(row.is_inactive) } : {}) };
}

export const getCoManagedPolicyScreen = withAuth(async (user, { tenant }, operationId?: string) => {
  if (user.user_type !== 'internal') throw new CoManagedPolicyError('FORBIDDEN');
  const { knex } = await createTenantKnex(tenant);
  return withTransaction(knex, async trx => {
    const resolved = await resolveTarget(trx, tenant, operationId);
    const policy = await getCoManagedCollaborationPolicy(trx, { tenant, userId: user.user_id }, resolved.target);
    const other = await tenantDb(trx, resolved.otherTenant).table('tenants').first('client_name');
    const lifecycle = await getCoManagedOperationalState(trx, resolved.target.customerTenant);
    // Sponsor administrators see only the explicitly granted customer labels.
    // Unselected resource searches below are always rooted in the actor's home.
    const labels: Record<CoManagedPolicyOptionKind, CoManagedPolicyOption[]> = { board: [], project: [], user: [], team: [] };
    for (const kind of ['board', 'project'] as const) {
      const ids = (kind === 'board' ? policy.boards : policy.projects).map(grant => grant.id);
      if (ids.length) {
        const { query, id } = optionQuery(trx, resolved.target.customerTenant, kind);
        labels[kind] = (await query.whereIn(id, ids)).map(toOption);
      }
    }
    if (resolved.side === 'sponsor') for (const kind of ['user', 'team'] as const) {
      const ids = policy.assignments.filter(item => item.kind === kind).map(item => item.principalId);
      if (ids.length) {
        const { query, id } = optionQuery(trx, tenant, kind);
        labels[kind] = (await query.whereIn(id, ids)).map(toOption);
      }
    }
    return { side: resolved.side, target: resolved.target, counterpartName: other?.client_name as string | undefined, policy, labels, canExpand: lifecycle.canWrite };
  });
});

export const searchCoManagedPolicyOptions = withAuth(async (user, { tenant }, input: {
  operationId?: string; kind: CoManagedPolicyOptionKind; search?: string; page?: number;
}) => {
  if (user.user_type !== 'internal') throw new CoManagedPolicyError('FORBIDDEN');
  if (!input || !['board', 'project', 'user', 'team'].includes(input.kind) ||
      (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 200)) ||
      (input.page !== undefined && (!Number.isSafeInteger(input.page) || input.page < 0 || input.page > 1000000))) throw new CoManagedPolicyError('INVALID_POLICY');
  const { knex } = await createTenantKnex(tenant);
  return withTransaction(knex, async trx => {
    const resolved = await resolveTarget(trx, tenant, input.operationId);
    await getCoManagedCollaborationPolicy(trx, { tenant, userId: user.user_id }, resolved.target);
    if ((resolved.side === 'customer') !== ['board', 'project'].includes(input.kind)) throw new CoManagedPolicyError('FORBIDDEN');
    const { query, id, name } = optionQuery(trx, tenant, input.kind);
    if (input.kind === 'user') query.where({ user_type: 'internal', is_inactive: false });
    if (input.kind === 'board') query.where('is_inactive', false);
    const search = input.search?.trim();
    if (search) query.where(builder => {
      builder.whereILike(name, `%${search}%`);
      if (input.kind === 'user') builder.orWhereILike('first_name', `%${search}%`).orWhereILike('last_name', `%${search}%`);
    });
    const rows = await query.orderBy(name).orderBy(id).offset((input.page ?? 0) * 25).limit(26);
    return { options: rows.slice(0, 25).map(toOption), hasMore: rows.length > 25 };
  });
});

export const saveCustomerCoManagedScope = withAuth(async (user, { tenant }, input: { revision: number; scope: CoManagedCustomerScope }) => {
  if (user.user_type !== 'internal') throw new CoManagedPolicyError('FORBIDDEN');
  if (!input) throw new CoManagedPolicyError('INVALID_POLICY');
  const { knex } = await createTenantKnex(tenant);
  return withTransaction(knex, async trx => {
    const resolved = await resolveTarget(trx, tenant);
    if (resolved.side !== 'customer') throw new CoManagedPolicyError('FORBIDDEN');
    return { revision: await replaceCoManagedCustomerScope(trx, { tenant, userId: user.user_id }, resolved.target, input.revision, input.scope) };
  });
});

export const saveSponsorCoManagedAssignments = withAuth(async (user, { tenant }, input: {
  operationId: string; revision: number; assignments: CoManagedStaffAssignment[];
}) => {
  if (user.user_type !== 'internal') throw new CoManagedPolicyError('FORBIDDEN');
  if (!input) throw new CoManagedPolicyError('INVALID_POLICY');
  const { knex } = await createTenantKnex(tenant);
  return withTransaction(knex, async trx => {
    const resolved = await resolveTarget(trx, tenant, input.operationId);
    if (resolved.side !== 'sponsor') throw new CoManagedPolicyError('FORBIDDEN');
    return { revision: await replaceCoManagedStaffAssignments(trx, { tenant, userId: user.user_id }, resolved.target, input.revision, input.assignments) };
  });
});
