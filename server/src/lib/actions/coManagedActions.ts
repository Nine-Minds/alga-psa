'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { getCoManagedEntitlementState, getLicenseStateRow, changeCoManagedAllocation, type CoManagedPurchaseOperation } from '@alga-psa/licensing';

export const canOpenCoManagedClientProvisioning = withAuth(async (user, { tenant }, clientId: string) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'read') ||
      !await hasPermission(user, 'co_management', 'manage') || !await hasPermission(user, 'client', 'read') ||
      !await hasPermission(user, 'ticket', 'read')) return false;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) return false;
  const { knex } = await createTenantKnex(tenant);
  const scoped = tenantDb(knex, tenant);
  const owner = await scoped.table('tenants').first('product_code', 'plan');
  if (owner?.product_code !== 'psa' || !await scoped.table('clients').where({ client_id: clientId, is_inactive: false }).first('client_id')) return false;
  if (owner.plan === 'pro') return true;
  const entitlement = await scoped.table('co_managed_entitlements').first('source');
  return entitlement?.source === 'self_host' && (await getCoManagedEntitlementState(knex, tenant)).capacity > 0;
});

export const getCoManagedBillingState = withAuth(async (user, { tenant }) => {
  if (user.user_type !== 'internal') throw new Error('Permission denied');
  const canReadRelationships = await hasPermission(user, 'co_management', 'read');
  if (!canReadRelationships && !await hasPermission(user, 'account_management', 'read')) throw new Error('Permission denied');
  const { knex } = await createTenantKnex(tenant);
  const scoped = tenantDb(knex, tenant);
  const owner = await scoped.table('tenants').first('product_code', 'plan');
  if (owner?.product_code !== 'psa') throw new Error('Only PSA workspaces can sponsor co-managed IT');
  const selfHosted = Boolean(await getLicenseStateRow());
  const state = await getCoManagedEntitlementState(knex, tenant);
  const pending: CoManagedPurchaseOperation | undefined = await scoped.table('co_managed_purchase_operations')
    .whereIn('state', ['preparing', 'checkout']).select('operation_id', 'quantity', 'state', 'provider_reference').first();
  return { ...state, selfHosted, canReadRelationships, isPro: owner.plan === 'pro' || (selfHosted && state.capacity > 0),
    canPurchase: !selfHosted && await hasPermission(user, 'account_management', 'update'), pending: pending ?? null };
});

export const getCoManagedProvisioningOptions = withAuth(async (user, { tenant }, search: string = '', selectedClientId?: string) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'manage') ||
      !await hasPermission(user, 'client', 'read') || !await hasPermission(user, 'ticket', 'read')) throw new Error('Permission denied');
  if (typeof search !== 'string' || search.length > 200 || (selectedClientId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedClientId))) throw new Error('Invalid client search.');
  const { knex } = await createTenantKnex(tenant);
  const scoped = tenantDb(knex, tenant);
  if ((await scoped.table('tenants').first('product_code'))?.product_code !== 'psa') throw new Error('Only PSA workspaces can sponsor co-managed IT.');
  const query = scoped.table('clients').where('is_inactive', false);
  if (search.trim()) query.whereILike('client_name', `%${search.trim()}%`);
  const clients = await query.orderBy('client_name').orderBy('client_id').limit(50).select('client_id', 'client_name');
  const selected = selectedClientId ? await scoped.table('clients').where({ client_id: selectedClientId, is_inactive: false }).first('client_id', 'client_name') : undefined;
  if (selected && !clients.some(client => client.client_id === selected.client_id)) clients.push(selected);
  const boards = await scoped.table('boards').where('is_inactive', false).orderBy('board_name').orderBy('board_id').select('board_id', 'board_name');
  return { clients: clients.map(client => ({ id: client.client_id as string, name: client.client_name as string })),
    boards: boards.map(board => ({ id: board.board_id as string, name: board.board_name as string })) };
});

export const getCoManagedProvisioningStatus = withAuth(async (user, { tenant }, page: number = 0) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'read')) throw new Error('Permission denied');
  if (!Number.isSafeInteger(page) || page < 0 || page > 1000000) throw new Error('Invalid page.');
  const { knex } = await createTenantKnex(tenant);
  const scoped = tenantDb(knex, tenant);
  const owner = await scoped.table('tenants').first('product_code');
  if (owner?.product_code !== 'psa') throw new Error('Only PSA workspaces can sponsor co-managed IT.');
  const operations = await scoped.table('co_managed_provisioning_operations').orderBy('created_at', 'desc').orderBy('operation_id')
    .offset(page * 25).limit(26).select('operation_id', 'customer_tenant', 'relationship_id', 'state', 'step',
      'request', 'error_code', 'invitation_sent_at', 'invitation_delivery_error');
  const allocations = operations.length ? await scoped.table('co_managed_allocations')
    .whereIn('operation_id', operations.map(operation => operation.operation_id)).select('operation_id', 'seats', 'state') : [];
  // Each foreign read is rooted in an operation owned by this authenticated
  // sponsor, and returns only relationship lifecycle state, never customer work.
  const items = await Promise.all(operations.slice(0, 25).map(async operation => {
    const relationship = await tenantDb(knex, operation.customer_tenant).table('co_management_relationships')
      .where({ relationship_id: operation.relationship_id, sponsor_tenant: tenant }).first('state');
    const allocation = allocations.find(row => row.operation_id === operation.operation_id);
    return { operationId: operation.operation_id as string, workspaceName: operation.request.workspaceName as string,
      administratorEmail: operation.request.administrator.email as string, seats: Number(allocation?.seats ?? operation.request.seats),
      canChangeSeats: Boolean(allocation && allocation.state !== 'released' && operation.state === 'pending_acceptance' &&
        ['active', 'pending_acceptance'].includes(relationship?.state)),
      state: (relationship?.state === 'active' || relationship?.state === 'terminated' ? relationship.state : operation.state) as string,
      invitationSent: Boolean(operation.invitation_sent_at),
      deliveryFailed: Boolean(operation.invitation_delivery_error),
      canRetry: ['queued', 'provisioning', 'failed'].includes(operation.state) ||
        (operation.state === 'pending_acceptance' && relationship?.state === 'pending_acceptance' && !operation.invitation_sent_at),
    };
  }));
  const canManage = await hasPermission(user, 'co_management', 'manage');
  return { items, hasMore: operations.length > 25, canManage,
    canCreate: canManage && await hasPermission(user, 'client', 'read') && await hasPermission(user, 'ticket', 'read') };
});

export const changeCoManagedWorkspaceSeats = withAuth(async (user, { tenant }, input: {
  operationId: string; seats: number; expectedSeats: number;
}) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'manage')) throw new Error('Permission denied');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.operationId)) throw new Error('Provisioning operation not found.');
  const { knex } = await createTenantKnex(tenant);
  const operation = await tenantDb(knex, tenant).table('co_managed_provisioning_operations').where('operation_id', input.operationId).first();
  if (!operation) throw new Error('Provisioning operation not found.');
  await changeCoManagedAllocation(knex, tenant, { customerTenant: operation.customer_tenant,
    relationshipId: operation.relationship_id, seats: input.seats, expectedSeats: input.expectedSeats });
});
