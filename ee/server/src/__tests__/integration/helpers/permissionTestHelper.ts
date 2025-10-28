/**
 * Permission Test Helper
 *
 * Utilities for setting up comprehensive permissions for E2E testing
 */

import { Knex } from 'knex';

/**
 * Seed the permissions table for a test tenant
 * This creates all the necessary MSP and client permissions
 */
export async function seedPermissionsForTenant(
  db: Knex,
  tenantId: string
): Promise<void> {
  console.log(`[Permission Helper] Seeding permissions for tenant ${tenantId}`);

  // Check if permissions already exist for this tenant
  const existingCount = await db('permissions')
    .where({ tenant: tenantId })
    .count('* as count')
    .first();

  if (existingCount && Number(existingCount.count) > 0) {
    console.log(`[Permission Helper] Tenant already has ${existingCount.count} permissions, skipping seed`);
    return;
  }

  // Define all MSP permissions needed for testing
  const mspPermissions = [
    // Asset permissions
    { resource: 'asset', action: 'create', msp: true, client: false, description: 'Create assets' },
    { resource: 'asset', action: 'read', msp: true, client: false, description: 'View assets' },
    { resource: 'asset', action: 'update', msp: true, client: false, description: 'Update assets' },
    { resource: 'asset', action: 'delete', msp: true, client: false, description: 'Delete assets' },

    // Billing permissions
    { resource: 'billing', action: 'create', msp: true, client: false, description: 'Create billing records' },
    { resource: 'billing', action: 'read', msp: true, client: false, description: 'View billing information' },
    { resource: 'billing', action: 'update', msp: true, client: false, description: 'Update billing records' },
    { resource: 'billing', action: 'delete', msp: true, client: false, description: 'Delete billing records' },

    // Client permissions
    { resource: 'client', action: 'create', msp: true, client: false, description: 'Create clients' },
    { resource: 'client', action: 'read', msp: true, client: false, description: 'View clients' },
    { resource: 'client', action: 'update', msp: true, client: false, description: 'Update clients' },
    { resource: 'client', action: 'delete', msp: true, client: false, description: 'Delete clients' },

    // Contact permissions
    { resource: 'contact', action: 'create', msp: true, client: false, description: 'Create contacts' },
    { resource: 'contact', action: 'read', msp: true, client: false, description: 'View contacts' },
    { resource: 'contact', action: 'update', msp: true, client: false, description: 'Update contacts' },
    { resource: 'contact', action: 'delete', msp: true, client: false, description: 'Delete contacts' },

    // Document permissions
    { resource: 'document', action: 'create', msp: true, client: false, description: 'Create documents' },
    { resource: 'document', action: 'read', msp: true, client: false, description: 'View documents' },
    { resource: 'document', action: 'update', msp: true, client: false, description: 'Update documents' },
    { resource: 'document', action: 'delete', msp: true, client: false, description: 'Delete documents' },

    // Invoice permissions
    { resource: 'invoice', action: 'create', msp: true, client: false, description: 'Create invoices' },
    { resource: 'invoice', action: 'read', msp: true, client: false, description: 'View invoices' },
    { resource: 'invoice', action: 'update', msp: true, client: false, description: 'Update invoices' },
    { resource: 'invoice', action: 'delete', msp: true, client: false, description: 'Delete invoices' },

    // Project permissions
    { resource: 'project', action: 'create', msp: true, client: false, description: 'Create projects' },
    { resource: 'project', action: 'read', msp: true, client: false, description: 'View projects' },
    { resource: 'project', action: 'update', msp: true, client: false, description: 'Update projects' },
    { resource: 'project', action: 'delete', msp: true, client: false, description: 'Delete projects' },

    // Project task permissions
    { resource: 'project_task', action: 'create', msp: true, client: false, description: 'Create project tasks' },
    { resource: 'project_task', action: 'read', msp: true, client: false, description: 'View project tasks' },
    { resource: 'project_task', action: 'update', msp: true, client: false, description: 'Update project tasks' },
    { resource: 'project_task', action: 'delete', msp: true, client: false, description: 'Delete project tasks' },

    // Ticket permissions
    { resource: 'ticket', action: 'create', msp: true, client: false, description: 'Create tickets' },
    { resource: 'ticket', action: 'read', msp: true, client: false, description: 'View tickets' },
    { resource: 'ticket', action: 'update', msp: true, client: false, description: 'Update tickets' },
    { resource: 'ticket', action: 'delete', msp: true, client: false, description: 'Delete tickets' },

    // Time entry permissions
    { resource: 'time_entry', action: 'create', msp: true, client: false, description: 'Create time entries' },
    { resource: 'time_entry', action: 'read', msp: true, client: false, description: 'View time entries' },
    { resource: 'time_entry', action: 'update', msp: true, client: false, description: 'Update time entries' },
    { resource: 'time_entry', action: 'delete', msp: true, client: false, description: 'Delete time entries' },

    // User permissions
    { resource: 'user', action: 'create', msp: true, client: false, description: 'Create users' },
    { resource: 'user', action: 'read', msp: true, client: false, description: 'View users' },
    { resource: 'user', action: 'update', msp: true, client: false, description: 'Update users' },
    { resource: 'user', action: 'delete', msp: true, client: false, description: 'Delete users' },
    { resource: 'user', action: 'list', msp: true, client: false, description: 'List users' },

    // Settings permissions
    { resource: 'settings', action: 'read', msp: true, client: true, description: 'View settings' },
    { resource: 'settings', action: 'create', msp: true, client: true, description: 'Create settings' },
    { resource: 'settings', action: 'update', msp: true, client: true, description: 'Update settings' },
    { resource: 'settings', action: 'delete', msp: true, client: true, description: 'Delete settings' },

    // Contract permissions
    { resource: 'contract', action: 'create', msp: true, client: false, description: 'Create contracts' },
    { resource: 'contract', action: 'read', msp: true, client: false, description: 'View contracts' },
    { resource: 'contract', action: 'update', msp: true, client: false, description: 'Update contracts' },
    { resource: 'contract', action: 'delete', msp: true, client: false, description: 'Delete contracts' },

    // Role permissions
    { resource: 'role', action: 'create', msp: true, client: false, description: 'Create roles' },
    { resource: 'role', action: 'read', msp: true, client: false, description: 'View roles' },
    { resource: 'role', action: 'update', msp: true, client: false, description: 'Update roles' },
    { resource: 'role', action: 'delete', msp: true, client: false, description: 'Delete roles' },

    // Tenant permissions
    { resource: 'tenant', action: 'read', msp: true, client: false, description: 'View tenant' },
    { resource: 'tenant', action: 'update', msp: true, client: false, description: 'Update tenant' },
  ];

  // Insert all permissions
  const permissionsToInsert = mspPermissions.map(perm => ({
    tenant: tenantId,
    resource: perm.resource,
    action: perm.action,
    msp: perm.msp,
    client: perm.client,
    description: perm.description
  }));

  await db('permissions').insert(permissionsToInsert);

  console.log(`[Permission Helper] ✓ Seeded ${permissionsToInsert.length} permissions for tenant ${tenantId}`);
}

/**
 * Grant ALL available permissions to a role for E2E testing
 * This is useful to avoid permission-related test failures
 */
export async function grantAllPermissionsToRole(
  db: Knex,
  tenantId: string,
  roleName: string = 'Admin'
): Promise<void> {
  console.log(`[Permission Helper] Granting all permissions to ${roleName} for tenant ${tenantId}`);

  // Get all available MSP permissions for this tenant
  const allPermissions = await db('permissions')
    .select('permission_id', 'resource', 'action')
    .where({ msp: true, tenant: tenantId });

  console.log(`[Permission Helper] Found ${allPermissions.length} total MSP permissions`);

  // Get the role for this tenant
  const role = await db('roles')
    .where({
      tenant: tenantId,
      role_name: roleName,
    })
    .first();

  if (!role) {
    console.error(`[Permission Helper] Role ${roleName} not found for tenant ${tenantId}`);
    console.log('[Permission Helper] Available roles:', await db('roles').where({ tenant: tenantId }).select('role_name'));
    throw new Error(`Role ${roleName} not found for tenant ${tenantId}`);
  }

  console.log(`[Permission Helper] Found role: ${role.role_name} (${role.role_id})`);

  // Get existing role permissions
  const existingPermissions = await db('role_permissions')
    .where({
      tenant: tenantId,
      role_id: role.role_id,
    })
    .select('permission_id');

  console.log(`[Permission Helper] Role already has ${existingPermissions.length} permissions`);

  const existingPermissionIds = new Set(
    existingPermissions.map((rp: any) => rp.permission_id)
  );

  // Insert missing permissions
  const permissionsToAdd = allPermissions.filter(
    (p: any) => !existingPermissionIds.has(p.permission_id)
  );

  if (permissionsToAdd.length > 0) {
    console.log(`[Permission Helper] Adding ${permissionsToAdd.length} new permissions`);
    console.log('[Permission Helper] Sample permissions:', permissionsToAdd.slice(0, 5).map(p => `${p.resource}.${p.action}`));

    await db('role_permissions').insert(
      permissionsToAdd.map((p: any) => ({
        tenant: tenantId,
        role_id: role.role_id,
        permission_id: p.permission_id,
      }))
    );
  } else {
    console.log('[Permission Helper] No new permissions to add');
  }

  // Verify the permissions were added
  const finalCount = await db('role_permissions')
    .where({
      tenant: tenantId,
      role_id: role.role_id,
    })
    .count('* as count')
    .first();

  console.log(
    `[Permission Helper] ✓ Granted ${permissionsToAdd.length} permissions. Total permissions for ${roleName}: ${finalCount?.count}`
  );
}

/**
 * Grant specific permissions to a role
 */
export async function grantPermissionsToRole(
  db: Knex,
  tenantId: string,
  roleName: string,
  permissions: Array<{ resource: string; action: string }>
): Promise<void> {
  const role = await db('roles')
    .where({ tenant: tenantId, role_name: roleName })
    .first();

  if (!role) {
    throw new Error(`Role ${roleName} not found`);
  }

  for (const perm of permissions) {
    // Find the permission ID
    const permission = await db('permissions')
      .where({
        resource: perm.resource,
        action: perm.action,
        msp: true,
        tenant: tenantId,
      })
      .first();

    if (!permission) {
      console.warn(`Permission ${perm.resource}.${perm.action} not found, skipping`);
      continue;
    }

    // Check if already granted
    const existing = await db('role_permissions')
      .where({
        tenant: tenantId,
        role_id: role.role_id,
        permission_id: permission.permission_id,
      })
      .first();

    if (!existing) {
      await db('role_permissions').insert({
        tenant: tenantId,
        role_id: role.role_id,
        permission_id: permission.permission_id,
      });
    }
  }

  console.log(`[Permission Helper] Granted ${permissions.length} permissions to ${roleName}`);
}

/**
 * Common test permissions for document operations
 */
export const DOCUMENT_TEST_PERMISSIONS = [
  { resource: 'document', action: 'read' },
  { resource: 'document', action: 'create' },
  { resource: 'document', action: 'update' },
  { resource: 'document', action: 'delete' },
  { resource: 'user', action: 'read' },
  { resource: 'user', action: 'list' },
  { resource: 'settings', action: 'read' },
  { resource: 'client', action: 'read' },
  { resource: 'tenant', action: 'read' },
  { resource: 'contact', action: 'read' },
  { resource: 'ticket', action: 'read' },
  { resource: 'project', action: 'read' },
  { resource: 'contract', action: 'read' },
];
