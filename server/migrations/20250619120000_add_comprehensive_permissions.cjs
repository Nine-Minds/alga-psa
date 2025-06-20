/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Get all tenants
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  // Define all new permissions needed based on security audit
  const newPermissions = [
    // Company permissions
    { resource: 'company', action: 'create' },
    { resource: 'company', action: 'read' },
    { resource: 'company', action: 'update' },
    { resource: 'company', action: 'delete' },
    
    // Document permissions
    { resource: 'document', action: 'create' },
    { resource: 'document', action: 'read' },
    { resource: 'document', action: 'update' },
    { resource: 'document', action: 'delete' },
    
    // Asset permissions
    { resource: 'asset', action: 'create' },
    { resource: 'asset', action: 'read' },
    { resource: 'asset', action: 'update' },
    { resource: 'asset', action: 'delete' },
    
    // Billing & Financial permissions
    { resource: 'billing', action: 'create' },
    { resource: 'billing', action: 'read' },
    { resource: 'billing', action: 'update' },
    { resource: 'billing', action: 'delete' },
    { resource: 'invoice', action: 'create' },
    { resource: 'invoice', action: 'read' },
    { resource: 'invoice', action: 'update' },
    { resource: 'invoice', action: 'delete' },
    { resource: 'invoice', action: 'generate' },
    { resource: 'invoice', action: 'finalize' },
    { resource: 'credit', action: 'create' },
    { resource: 'credit', action: 'read' },
    { resource: 'credit', action: 'update' },
    { resource: 'credit', action: 'delete' },
    { resource: 'credit', action: 'transfer' },
    { resource: 'credit', action: 'reconcile' },
    { resource: 'tax', action: 'create' },
    { resource: 'tax', action: 'read' },
    { resource: 'tax', action: 'update' },
    { resource: 'tax', action: 'delete' },
    
    // Time tracking permissions
    { resource: 'timeentry', action: 'create' },
    { resource: 'timeentry', action: 'read' },
    { resource: 'timeentry', action: 'update' },
    { resource: 'timeentry', action: 'delete' },
    { resource: 'timesheet', action: 'read' },
    { resource: 'timesheet', action: 'read_all' },
    { resource: 'timesheet', action: 'submit' },
    { resource: 'timesheet', action: 'approve' },
    { resource: 'timesheet', action: 'comment' },
    { resource: 'timesheet', action: 'reverse' },
    { resource: 'timeperiod', action: 'read' },
    { resource: 'timeperiod', action: 'create' },
    { resource: 'timeperiod', action: 'update' },
    { resource: 'timeperiod', action: 'delete' },
    { resource: 'timeperiod', action: 'generate' },
    
    // Other business permissions
    { resource: 'contact', action: 'create' },
    { resource: 'contact', action: 'read' },
    { resource: 'contact', action: 'update' },
    { resource: 'contact', action: 'delete' },
    { resource: 'team', action: 'create' },
    { resource: 'team', action: 'read' },
    { resource: 'team', action: 'update' },
    { resource: 'team', action: 'delete' },
    { resource: 'team', action: 'manage_members' },
    { resource: 'service', action: 'create' },
    { resource: 'service', action: 'read' },
    { resource: 'service', action: 'update' },
    { resource: 'service', action: 'delete' },
    { resource: 'workflow', action: 'read' },
    { resource: 'workflow', action: 'manage' },
    { resource: 'comment', action: 'create' },
    { resource: 'comment', action: 'read' },
    { resource: 'comment', action: 'update' },
    { resource: 'comment', action: 'delete' },
    { resource: 'interaction', action: 'create' },
    { resource: 'interaction', action: 'read' },
    { resource: 'interaction', action: 'update' },
    { resource: 'interaction', action: 'delete' },
    { resource: 'tag', action: 'create' },
    { resource: 'tag', action: 'read' },
    { resource: 'tag', action: 'update' },
    { resource: 'tag', action: 'delete' },
    { resource: 'priority', action: 'create' },
    { resource: 'priority', action: 'read' },
    { resource: 'priority', action: 'update' },
    { resource: 'priority', action: 'delete' },
    { resource: 'category', action: 'read' },
    { resource: 'notification', action: 'read' },
    { resource: 'notification', action: 'manage' },
    { resource: 'template', action: 'manage' },
    { resource: 'email', action: 'process' }
  ];

  // For each tenant, add the permissions
  for (const { tenant } of tenants) {
    // Get existing permissions to avoid duplicates
    const existingPerms = await knex('permissions')
      .where({ tenant })
      .select('resource', 'action');

    const existingMap = new Set(existingPerms.map(p => `${p.resource}:${p.action}`));

    const permissionsToAdd = newPermissions
      .filter(p => !existingMap.has(`${p.resource}:${p.action}`))
      .map(p => ({
        tenant,
        permission_id: knex.raw('gen_random_uuid()'),
        ...p,
        created_at: new Date()
      }));

    if (permissionsToAdd.length > 0) {
      await knex('permissions').insert(permissionsToAdd);
      console.log(`Added ${permissionsToAdd.length} new permissions for tenant ${tenant}`);
    }

    // Get Admin role for this tenant (case-insensitive)
    const roles = await knex('roles').where({ tenant });
    const adminRole = roles.find(r => 
      r.role_name && r.role_name.toLowerCase() === 'admin'
    );

    if (adminRole) {
      // Get all permissions for this tenant
      const allPermissions = await knex('permissions')
        .where({ tenant })
        .select('permission_id');

      // Get existing role permissions for admin
      const existingRolePerms = await knex('role_permissions')
        .where({
          tenant,
          role_id: adminRole.role_id
        })
        .select('permission_id');

      const existingRolePermIds = new Set(existingRolePerms.map(rp => rp.permission_id));

      // Add missing permissions to admin role
      const rolePermissionsToAdd = allPermissions
        .filter(p => !existingRolePermIds.has(p.permission_id))
        .map(p => ({
          tenant,
          role_id: adminRole.role_id,
          permission_id: p.permission_id
        }));

      if (rolePermissionsToAdd.length > 0) {
        await knex('role_permissions').insert(rolePermissionsToAdd);
        console.log(`Added ${rolePermissionsToAdd.length} role permissions to Admin role for tenant ${tenant}`);
      }
    }

    // Also assign appropriate permissions to Manager role if it exists
    const managerRole = roles.find(r => 
      r.role_name && r.role_name.toLowerCase() === 'manager'
    );

    if (managerRole) {
      // Manager gets most permissions except sensitive ones like user:delete, billing:delete, etc.
      const managerPermissions = await knex('permissions')
        .where({ tenant })
        .where(function() {
          // Core business operations
          this.where(function() {
            this.where('resource', 'ticket').whereIn('action', ['create', 'read', 'update', 'delete']);
          })
          .orWhere(function() {
            this.where('resource', 'project').whereIn('action', ['create', 'read', 'update', 'delete']);
          })
          .orWhere(function() {
            this.where('resource', 'company').whereIn('action', ['read', 'update']);
          })
          .orWhere(function() {
            this.where('resource', 'contact').whereIn('action', ['create', 'read', 'update', 'delete']);
          })
          .orWhere(function() {
            this.where('resource', 'document').whereIn('action', ['create', 'read', 'update', 'delete']);
          })
          .orWhere(function() {
            this.where('resource', 'asset').whereIn('action', ['create', 'read', 'update', 'delete']);
          })
          .orWhere(function() {
            this.where('resource', 'timeentry').whereIn('action', ['create', 'read', 'update', 'delete']);
          })
          .orWhere(function() {
            this.where('resource', 'timesheet').whereIn('action', ['read', 'read_all', 'approve', 'comment', 'reverse']);
          })
          .orWhere(function() {
            this.where('resource', 'team').whereIn('action', ['read', 'manage_members']);
          })
          .orWhere(function() {
            this.where('resource', 'service').whereIn('action', ['read', 'update']);
          })
          .orWhere(function() {
            this.where('resource', 'comment').whereIn('action', ['create', 'read', 'update', 'delete']);
          })
          .orWhere(function() {
            this.where('resource', 'interaction').whereIn('action', ['create', 'read', 'update', 'delete']);
          })
          .orWhere(function() {
            this.where('resource', 'tag').whereIn('action', ['create', 'read', 'update', 'delete']);
          })
          .orWhere(function() {
            this.where('resource', 'priority').whereIn('action', ['read', 'update']);
          })
          .orWhere(function() {
            this.where('resource', 'category').whereIn('action', ['read']);
          })
          .orWhere(function() {
            this.where('resource', 'workflow').whereIn('action', ['read']);
          });
        })
        .select('permission_id');

      // Get existing role permissions for manager
      const existingManagerPerms = await knex('role_permissions')
        .where({
          tenant,
          role_id: managerRole.role_id
        })
        .select('permission_id');

      const existingManagerPermIds = new Set(existingManagerPerms.map(rp => rp.permission_id));

      // Add missing permissions to manager role
      const managerRolePermissionsToAdd = managerPermissions
        .filter(p => !existingManagerPermIds.has(p.permission_id))
        .map(p => ({
          tenant,
          role_id: managerRole.role_id,
          permission_id: p.permission_id
        }));

      if (managerRolePermissionsToAdd.length > 0) {
        await knex('role_permissions').insert(managerRolePermissionsToAdd);
        console.log(`Added ${managerRolePermissionsToAdd.length} role permissions to Manager role for tenant ${tenant}`);
      }
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Get all tenants
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  // Define the resources we added
  const resourcesToRemove = [
    'company', 'document', 'asset', 'billing', 'invoice', 'credit', 'tax',
    'timeentry', 'timesheet', 'timeperiod', 'contact', 'team', 'service',
    'workflow', 'comment', 'interaction', 'tag', 'priority', 'category',
    'notification', 'template', 'email'
  ];

  for (const { tenant } of tenants) {
    // Remove role permissions first (foreign key constraint)
    await knex('role_permissions')
      .where('tenant', tenant)
      .whereIn('permission_id', function() {
        this.select('permission_id')
          .from('permissions')
          .where('tenant', tenant)
          .whereIn('resource', resourcesToRemove);
      })
      .delete();

    // Remove permissions
    await knex('permissions')
      .where('tenant', tenant)
      .whereIn('resource', resourcesToRemove)
      .delete();
  }
};