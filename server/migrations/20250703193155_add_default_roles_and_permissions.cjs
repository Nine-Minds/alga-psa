/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // First, add the description column to permissions table if it doesn't exist
  const hasDescriptionColumn = await knex.schema.hasColumn('permissions', 'description');
  if (!hasDescriptionColumn) {
    await knex.schema.alterTable('permissions', (table) => {
      table.text('description');
    });
  }

  // Helper function to create a permission if it doesn't exist
  const ensurePermission = async (tenant, resource, action, msp = true, client = false, description = null) => {
    const existing = await knex('permissions')
      .where({ tenant, resource, action })
      .first();
    
    if (!existing) {
      const [permission] = await knex('permissions')
        .insert({
          tenant,
          resource,
          action,
          msp,
          client,
          description,
          permission_id: knex.raw('gen_random_uuid()'),
          created_at: knex.fn.now()
        })
        .returning('*');
      return permission;
    }
    
    // Update existing permission with msp/client flags and description
    await knex('permissions')
      .where({ tenant, resource, action })
      .update({ msp, client, description });
    
    return existing;
  };

  // Helper function to create a role if it doesn't exist
  const ensureRole = async (tenant, roleName, description, msp = true, client = false) => {
    // For roles that can exist in both portals, we need to check for the specific portal
    const existing = await knex('roles')
      .where({ tenant, role_name: roleName, msp, client })
      .first();
    
    if (!existing) {
      // Check if role with same name exists in opposite portal
      const oppositePortalRole = await knex('roles')
        .where({ tenant, role_name: roleName })
        .whereNot({ msp, client })
        .first();
      
      if (oppositePortalRole) {
        // Role exists in opposite portal, create new one for this portal
        const [role] = await knex('roles')
          .insert({
            tenant,
            role_name: roleName,
            description,
            msp,
            client,
            role_id: knex.raw('gen_random_uuid()'),
            created_at: knex.fn.now()
          })
          .returning('*');
        return role;
      } else {
        // No role with this name exists, create it
        const [role] = await knex('roles')
          .insert({
            tenant,
            role_name: roleName,
            description,
            msp,
            client,
            role_id: knex.raw('gen_random_uuid()'),
            created_at: knex.fn.now()
          })
          .returning('*');
        return role;
      }
    }
    
    // Update existing role's description if needed
    if (existing.description !== description) {
      await knex('roles')
        .where({ tenant, role_id: existing.role_id })
        .update({ description });
    }
    
    return existing;
  };

  // Helper function to assign permission to role
  const assignPermissionToRole = async (tenant, roleId, permissionId) => {
    const existing = await knex('role_permissions')
      .where({ tenant, role_id: roleId, permission_id: permissionId })
      .first();
    
    if (!existing) {
      await knex('role_permissions').insert({
        tenant,
        role_id: roleId,
        permission_id: permissionId,
        created_at: knex.fn.now()
      });
    }
  };

  // Get all tenants
  const tenants = await knex('tenants').select('tenant');

  for (const { tenant } of tenants) {
    console.log(`Processing tenant: ${tenant}`);

    // First, handle Admin role conversions
    // Convert all existing "Admin" roles to MSP Admin (they were MSP admins before)
    // This needs to happen BEFORE any other role conversions to ensure proper assignment
    const adminRolesWithoutFlags = await knex('roles')
      .where({ tenant, role_name: 'Admin' })
      .where(function() {
        this.whereNull('msp').orWhereNull('client');
      });
    
    if (adminRolesWithoutFlags.length > 0) {
      console.log(`Converting ${adminRolesWithoutFlags.length} existing Admin roles to MSP Admin for tenant ${tenant}`);
      await knex('roles')
        .where({ tenant, role_name: 'Admin' })
        .where(function() {
          this.whereNull('msp').orWhereNull('client');
        })
        .update({ 
          msp: true,
          client: false,
          description: 'Full system administrator access'
        });
    }

    // First, clean up any duplicate roles that might exist from previous migrations
    // Find all roles grouped by name and portal flags
    const duplicateRoles = await knex('roles')
      .select('role_name', 'msp', 'client')
      .count('* as count')
      .where({ tenant })
      .groupBy('role_name', 'msp', 'client')
      .having(knex.raw('count(*) > 1'));

    for (const dup of duplicateRoles) {
      console.log(`Found ${dup.count} duplicate "${dup.role_name}" roles in ${dup.msp ? 'MSP' : 'Client'} portal`);
      
      // Get all roles with this name and portal flags
      const roles = await knex('roles')
        .where({ 
          tenant, 
          role_name: dup.role_name,
          msp: dup.msp,
          client: dup.client
        })
        .orderBy('created_at', 'asc');
      
      if (roles.length > 1) {
        // Keep the first (oldest) role
        const keepRole = roles[0];
        const deleteRoleIds = roles.slice(1).map(r => r.role_id);
        
        // Move any user assignments from duplicate roles to the kept role
        for (const deleteRoleId of deleteRoleIds) {
          // Get users assigned to the duplicate role
          const userAssignments = await knex('user_roles')
            .where({ tenant, role_id: deleteRoleId });
          
          for (const assignment of userAssignments) {
            // Check if user already has the kept role
            const existingAssignment = await knex('user_roles')
              .where({ 
                tenant, 
                user_id: assignment.user_id,
                role_id: keepRole.role_id
              })
              .first();
            
            if (!existingAssignment) {
              // Move assignment to kept role
              await knex('user_roles')
                .where({ 
                  tenant,
                  user_id: assignment.user_id,
                  role_id: deleteRoleId
                })
                .update({ role_id: keepRole.role_id });
            } else {
              // User already has kept role, delete duplicate assignment
              await knex('user_roles')
                .where({ 
                  tenant,
                  user_id: assignment.user_id,
                  role_id: deleteRoleId
                })
                .delete();
            }
          }
          
          // Delete role_permissions for duplicate role
          await knex('role_permissions')
            .where({ tenant, role_id: deleteRoleId })
            .delete();
          
          // Delete the duplicate role
          await knex('roles')
            .where({ tenant, role_id: deleteRoleId })
            .delete();
          
          console.log(`Deleted duplicate role ${deleteRoleId} and moved assignments to ${keepRole.role_id}`);
        }
      }
    }

    // Now convert existing Client and Client_Admin roles from MSP to Client portal
    // This preserves user assignments while moving roles to correct portal
    
    // Convert 'Client' role (case-insensitive) to 'User' role in client portal
    const existingClientRoles = await knex('roles')
      .where({ tenant })
      .where(knex.raw('LOWER(role_name) = LOWER(?)', ['Client']))
      .select('*');
    
    if (existingClientRoles.length > 0) {
      console.log(`Converting ${existingClientRoles.length} Client role(s) to User role for tenant ${tenant}`);
      for (const role of existingClientRoles) {
        await knex('roles')
          .where({ tenant, role_id: role.role_id })
          .update({ 
            role_name: 'User',
            description: 'Standard client portal user',
            msp: false,
            client: true
          });
      }
    }

    // Convert 'Client_Admin' role (case-insensitive) to 'Admin' role in client portal
    const existingClientAdminRoles = await knex('roles')
      .where({ tenant })
      .where(knex.raw('LOWER(role_name) = LOWER(?)', ['Client_Admin']))
      .select('*');
    
    if (existingClientAdminRoles.length > 0) {
      console.log(`Converting ${existingClientAdminRoles.length} Client_Admin role(s) to Admin role in client portal for tenant ${tenant}`);
      for (const role of existingClientAdminRoles) {
        await knex('roles')
          .where({ tenant, role_id: role.role_id })
          .update({ 
            role_name: 'Admin',
            description: 'Client portal administrator',
            msp: false,
            client: true
          });
      }
    }

    // Also handle any other MSP roles that don't have flags set yet
    const mspRoleNames = ['Manager', 'Technician', 'Finance', 'Project Manager', 'Dispatcher'];
    for (const roleName of mspRoleNames) {
      await knex('roles')
        .where({ tenant, role_name: roleName })
        .whereNull('msp') // Only update roles that haven't been flagged yet
        .update({ 
          msp: true,
          client: false
        });
    }

    // Clean up any remaining Client_Admin roles after conversion (case-insensitive)
    // Note: We already converted Client_Admin to Admin in client portal above,
    // so this is just a safety check to ensure no orphaned Client_Admin roles remain
    const remainingClientAdminRoles = await knex('roles')
      .where({ tenant })
      .where(knex.raw('LOWER(role_name) = LOWER(?)', ['Client_Admin']))
      .count('* as count');
    
    if (remainingClientAdminRoles[0].count > 0) {
      console.log(`WARNING: Found ${remainingClientAdminRoles[0].count} remaining Client_Admin roles for tenant ${tenant} after conversion. This should not happen.`);
      // Don't delete - log for investigation
    }

    // Create MSP Roles
    const mspAdminRole = await ensureRole(tenant, 'Admin', 'Full system administrator access', true, false);
    const mspFinanceRole = await ensureRole(tenant, 'Finance', 'Financial operations and billing management', true, false);
    const mspTechnicianRole = await ensureRole(tenant, 'Technician', 'Technical support and ticket management', true, false);
    const mspProjectManagerRole = await ensureRole(tenant, 'Project Manager', 'Project planning and management', true, false);
    const mspDispatcherRole = await ensureRole(tenant, 'Dispatcher', 'Technician scheduling and dispatch', true, false);

    // Create Client Roles
    const clientUserRole = await ensureRole(tenant, 'User', 'Standard client portal user', false, true);
    const clientFinanceRole = await ensureRole(tenant, 'Finance', 'Client financial operations', false, true);
    
    // Only create client Admin role if there are no existing Admin roles without flags
    // This prevents converting pre-existing MSP admins into client admins
    let clientAdminRole;
    const existingAdminWithoutFlags = await knex('roles')
      .where({ tenant, role_name: 'Admin' })
      .where(function() {
        this.whereNull('msp').orWhereNull('client');
      })
      .first();
    
    if (!existingAdminWithoutFlags) {
      // Safe to create client admin role
      clientAdminRole = await ensureRole(tenant, 'Admin', 'Client portal administrator', false, true);
    } else {
      // Use the existing client admin role if it exists
      clientAdminRole = await knex('roles')
        .where({ tenant, role_name: 'Admin', msp: false, client: true })
        .first();
      
      if (!clientAdminRole) {
        // Create it if it doesn't exist yet
        clientAdminRole = await ensureRole(tenant, 'Admin', 'Client portal administrator', false, true);
      }
    }

    // Define all permissions needed
    const permissions = [
      // Asset permissions - MSP only
      { resource: 'asset', action: 'create', msp: true, client: false, description: 'Create new assets and equipment records' },
      { resource: 'asset', action: 'read', msp: true, client: false, description: 'View asset details and inventory' },
      { resource: 'asset', action: 'update', msp: true, client: false, description: 'Modify asset information and status' },
      { resource: 'asset', action: 'delete', msp: true, client: false, description: 'Remove assets from the system' },
      
      // Billing permissions - MSP only
      { resource: 'billing', action: 'create', msp: true, client: false, description: 'Create billing records and charges' },
      { resource: 'billing', action: 'read', msp: true, client: false, description: 'View billing information and history' },
      { resource: 'billing', action: 'update', msp: true, client: false, description: 'Modify billing records and rates' },
      { resource: 'billing', action: 'delete', msp: true, client: false, description: 'Remove billing records' },
      { resource: 'billing', action: 'reconcile', msp: true, client: false, description: 'Reconcile billing discrepancies and adjustments' },
      
      // Client permissions - MSP only
      { resource: 'client', action: 'create', msp: true, client: false, description: 'Add new client accounts' },
      { resource: 'client', action: 'read', msp: true, client: false, description: 'View client information and details' },
      { resource: 'client', action: 'update', msp: true, client: false, description: 'Modify client account information' },
      { resource: 'client', action: 'delete', msp: true, client: false, description: 'Remove client accounts' },
      
      // Company permissions - Read and update for clients
      { resource: 'company', action: 'create', msp: true, client: false, description: 'Create new company profiles' },
      { resource: 'company', action: 'read', msp: true, client: true, description: 'View company information and settings' },
      { resource: 'company', action: 'update', msp: true, client: true, description: 'Edit company details and preferences' },
      { resource: 'company', action: 'delete', msp: true, client: false, description: 'Remove company profiles' },
      
      // Contact permissions - MSP only
      { resource: 'contact', action: 'create', msp: true, client: false, description: 'Add new contacts to companies' },
      { resource: 'contact', action: 'read', msp: true, client: false, description: 'View contact information' },
      { resource: 'contact', action: 'update', msp: true, client: false, description: 'Edit contact details' },
      { resource: 'contact', action: 'delete', msp: true, client: false, description: 'Remove contacts from the system' },
      
      // Credit permissions - MSP only
      { resource: 'credit', action: 'create', msp: true, client: false, description: 'Issue credits to accounts' },
      { resource: 'credit', action: 'read', msp: true, client: false, description: 'View credit balances and history' },
      { resource: 'credit', action: 'update', msp: true, client: false, description: 'Modify credit amounts and details' },
      { resource: 'credit', action: 'delete', msp: true, client: false, description: 'Remove credit records' },
      { resource: 'credit', action: 'transfer', msp: true, client: false, description: 'Transfer credits between accounts' },
      { resource: 'credit', action: 'apply', msp: true, client: false, description: 'Apply credits to invoices or charges' },
      
      // Document permissions - Available to clients
      { resource: 'document', action: 'create', msp: true, client: true, description: 'Upload and create documents' },
      { resource: 'document', action: 'read', msp: true, client: true, description: 'View and download documents' },
      { resource: 'document', action: 'update', msp: true, client: true, description: 'Edit document metadata and content' },
      { resource: 'document', action: 'delete', msp: true, client: false, description: 'Delete documents from the system' },
      
      // Invoice permissions - MSP only
      { resource: 'invoice', action: 'create', msp: true, client: false, description: 'Create new invoices' },
      { resource: 'invoice', action: 'read', msp: true, client: false, description: 'View invoice details and history' },
      { resource: 'invoice', action: 'update', msp: true, client: false, description: 'Modify invoice line items and details' },
      { resource: 'invoice', action: 'delete', msp: true, client: false, description: 'Delete draft invoices' },
      { resource: 'invoice', action: 'generate', msp: true, client: false, description: 'Generate invoices from billable items' },
      { resource: 'invoice', action: 'finalize', msp: true, client: false, description: 'Finalize and lock invoices' },
      { resource: 'invoice', action: 'send', msp: true, client: false, description: 'Send invoices to clients' },
      
      // Profile permissions - MSP only
      { resource: 'profile', action: 'create', msp: true, client: false, description: 'Create new user profiles' },
      { resource: 'profile', action: 'read', msp: true, client: false, description: 'View user profile information' },
      { resource: 'profile', action: 'update', msp: true, client: false, description: 'Edit user profile details' },
      { resource: 'profile', action: 'delete', msp: true, client: false, description: 'Remove user profiles' },
      
      // Project permissions - Read-only for clients
      { resource: 'project', action: 'create', msp: true, client: false, description: 'Create new projects' },
      { resource: 'project', action: 'read', msp: true, client: true, description: 'View project details and status' },
      { resource: 'project', action: 'update', msp: true, client: false, description: 'Modify project information and timeline' },
      { resource: 'project', action: 'delete', msp: true, client: false, description: 'Delete projects and associated data' },
      
      // Tag permissions - MSP only
      { resource: 'tag', action: 'create', msp: true, client: false, description: 'Create new tags for categorization' },
      { resource: 'tag', action: 'read', msp: true, client: false, description: 'View available tags' },
      { resource: 'tag', action: 'update', msp: true, client: false, description: 'Edit tags content and colors' },
      { resource: 'tag', action: 'delete', msp: true, client: false, description: 'Remove tags from the system' },
      
      // Technician dispatch permissions
      { resource: 'technician_dispatch', action: 'create', msp: true, client: false, description: 'Create dispatch schedules for technicians' },
      { resource: 'technician_dispatch', action: 'read', msp: true, client: false, description: 'View technician schedules and assignments' },
      { resource: 'technician_dispatch', action: 'update', msp: true, client: false, description: 'Modify dispatch assignments and timing' },
      { resource: 'technician_dispatch', action: 'delete', msp: true, client: false, description: 'Remove dispatch assignments' },
      
      // Ticket permissions
      { resource: 'ticket', action: 'create', msp: true, client: true, description: 'Create support tickets' },
      { resource: 'ticket', action: 'read', msp: true, client: true, description: 'View ticket details and history' },
      { resource: 'ticket', action: 'update', msp: true, client: true, description: 'Update ticket status and add comments' },
      { resource: 'ticket', action: 'delete', msp: true, client: false, description: 'Delete tickets from the system' },
      
      // Time entry permissions
      { resource: 'timeentry', action: 'create', msp: true, client: false, description: 'Log time entries for work performed' },
      { resource: 'timeentry', action: 'read', msp: true, client: false, description: 'View time entry records' },
      { resource: 'timeentry', action: 'update', msp: true, client: false, description: 'Edit time entry details and duration' },
      { resource: 'timeentry', action: 'delete', msp: true, client: false, description: 'Remove time entries' },
      
      // Timesheet permissions
      { resource: 'timesheet', action: 'create', msp: true, client: false, description: 'Create timesheets for time tracking' },
      { resource: 'timesheet', action: 'read', msp: true, client: false, description: 'View timesheet summaries and details' },
      { resource: 'timesheet', action: 'update', msp: true, client: false, description: 'Modify timesheet entries' },
      { resource: 'timesheet', action: 'delete', msp: true, client: false, description: 'Delete timesheets' },
      { resource: 'timesheet', action: 'submit', msp: true, client: false, description: 'Submit timesheets for approval' },
      { resource: 'timesheet', action: 'approve', msp: true, client: false, description: 'Approve or reject submitted timesheets' },
      
      // User permissions - Available in both portals as each manages their own users
      { resource: 'user', action: 'create', msp: true, client: true, description: 'Create new user accounts' },
      { resource: 'user', action: 'read', msp: true, client: true, description: 'View user information and status' },
      { resource: 'user', action: 'update', msp: true, client: true, description: 'Edit user details and permissions' },
      { resource: 'user', action: 'delete', msp: true, client: true, description: 'Remove user accounts' },
      { resource: 'user', action: 'invite', msp: true, client: true, description: 'Send invitations to new users' },
      { resource: 'user', action: 'reset_password', msp: true, client: true, description: 'Reset user passwords' },
      
      // User schedule permissions
      { resource: 'user_schedule', action: 'create', msp: true, client: false, description: 'Create user work schedules' },
      { resource: 'user_schedule', action: 'read', msp: true, client: false, description: 'View user availability and schedules' },
      { resource: 'user_schedule', action: 'update', msp: true, client: false, description: 'Modify user schedule assignments' },
      { resource: 'user_schedule', action: 'delete', msp: true, client: false, description: 'Remove user schedules' },
      
      // Settings permissions
      { resource: 'ticket_settings', action: 'read', msp: true, client: false, description: 'View ticket system configuration' },
      { resource: 'ticket_settings', action: 'update', msp: true, client: false, description: 'Configure ticket workflows and rules' },
      { resource: 'user_settings', action: 'read', msp: true, client: true, description: 'View personal user preferences' },
      { resource: 'user_settings', action: 'update', msp: true, client: true, description: 'Update personal preferences and notifications' },
      { resource: 'system_settings', action: 'read', msp: true, client: false, description: 'View system-wide configuration' },
      { resource: 'system_settings', action: 'update', msp: true, client: false, description: 'Modify system configuration and defaults' },
      { resource: 'security_settings', action: 'read', msp: true, client: false, description: 'View security policies and settings' },
      { resource: 'security_settings', action: 'update', msp: true, client: false, description: 'Configure security policies and access controls' },
      { resource: 'timeentry_settings', action: 'read', msp: true, client: false, description: 'View time tracking configuration' },
      { resource: 'timeentry_settings', action: 'update', msp: true, client: false, description: 'Configure time tracking rules and defaults' },
      { resource: 'billing_settings', action: 'create', msp: true, client: false, description: 'Create billing configuration profiles' },
      { resource: 'billing_settings', action: 'read', msp: true, client: false, description: 'View billing rates and rules' },
      { resource: 'billing_settings', action: 'update', msp: true, client: false, description: 'Modify billing rates and configuration' },
      { resource: 'billing_settings', action: 'delete', msp: true, client: false, description: 'Remove billing configuration profiles' },
    ];

    // Create all permissions
    const permissionMap = new Map();
    for (const perm of permissions) {
      const permission = await ensurePermission(tenant, perm.resource, perm.action, perm.msp, perm.client, perm.description);
      permissionMap.set(`${perm.resource}:${perm.action}`, permission.permission_id);
    }

    // MSP Admin - Full access to all MSP permissions
    for (const perm of permissions.filter(p => p.msp)) {
      const permId = permissionMap.get(`${perm.resource}:${perm.action}`);
      if (permId) {
        await assignPermissionToRole(tenant, mspAdminRole.role_id, permId);
      }
    }

    // MSP Finance - Specific permissions as defined
    const financePermissions = [
      'asset:read',
      'billing:create', 'billing:read', 'billing:update', 'billing:delete', 'billing:reconcile',
      'client:create', 'client:read', 'client:update', 'client:delete',
      'contact:create', 'contact:read', 'contact:update', 'contact:delete',
      'credit:create', 'credit:read', 'credit:update', 'credit:delete', 'credit:transfer', 'credit:apply',
      'document:create', 'document:read', 'document:update', 'document:delete',
      'invoice:create', 'invoice:read', 'invoice:update', 'invoice:delete', 'invoice:generate', 'invoice:finalize',
      'profile:create', 'profile:read', 'profile:update', 'profile:delete',
      'project:read', 'project:update',
      'tag:create', 'tag:read',
      'technician_dispatch:read',
      'ticket:read', 'ticket:update',
      'timeentry:create', 'timeentry:read', 'timeentry:update', 'timeentry:delete',
      'timesheet:create', 'timesheet:read', 'timesheet:update', 'timesheet:delete', 'timesheet:submit',
      'user:read',
      'user_schedule:read',
      'billing_settings:create', 'billing_settings:read', 'billing_settings:update', 'billing_settings:delete'
    ];

    for (const permKey of financePermissions) {
      const permId = permissionMap.get(permKey);
      if (permId) {
        await assignPermissionToRole(tenant, mspFinanceRole.role_id, permId);
      }
    }

    // MSP Technician - Ticket and time management focused
    const technicianPermissions = [
      'asset:read',
      'contact:read',
      'document:create', 'document:read', 'document:update',
      'profile:read', 'profile:update',
      'project:read',
      'tag:read',
      'ticket:create', 'ticket:read', 'ticket:update',
      'timeentry:create', 'timeentry:read', 'timeentry:update',
      'timesheet:create', 'timesheet:read', 'timesheet:update', 'timesheet:submit',
      'user:read',
      'user_schedule:read',
      'user_settings:read', 'user_settings:update'
    ];

    for (const permKey of technicianPermissions) {
      const permId = permissionMap.get(permKey);
      if (permId) {
        await assignPermissionToRole(tenant, mspTechnicianRole.role_id, permId);
      }
    }

    // MSP Project Manager - Project and resource management
    const projectManagerPermissions = [
      'asset:read',
      'client:read',
      'contact:create', 'contact:read', 'contact:update',
      'document:create', 'document:read', 'document:update', 'document:delete',
      'invoice:read',
      'profile:read',
      'project:create', 'project:read', 'project:update', 'project:delete',
      'tag:create', 'tag:read', 'tag:update',
      'technician_dispatch:read',
      'ticket:create', 'ticket:read', 'ticket:update',
      'timeentry:read',
      'timesheet:read', 'timesheet:approve',
      'user:read',
      'user_schedule:read'
    ];

    for (const permKey of projectManagerPermissions) {
      const permId = permissionMap.get(permKey);
      if (permId) {
        await assignPermissionToRole(tenant, mspProjectManagerRole.role_id, permId);
      }
    }

    // MSP Dispatcher - Scheduling and dispatch
    const dispatcherPermissions = [
      'contact:read',
      'profile:read',
      'technician_dispatch:create', 'technician_dispatch:read', 'technician_dispatch:update', 'technician_dispatch:delete',
      'ticket:read', 'ticket:update',
      'user:read',
      'user_schedule:create', 'user_schedule:read', 'user_schedule:update', 'user_schedule:delete'
    ];

    for (const permKey of dispatcherPermissions) {
      const permId = permissionMap.get(permKey);
      if (permId) {
        await assignPermissionToRole(tenant, mspDispatcherRole.role_id, permId);
      }
    }

    // Client Admin - Full access to client permissions
    if (clientAdminRole) {
      for (const perm of permissions.filter(p => p.client)) {
        const permId = permissionMap.get(`${perm.resource}:${perm.action}`);
        if (permId) {
          await assignPermissionToRole(tenant, clientAdminRole.role_id, permId);
        }
      }
    }

    // Client Finance - Financial visibility
    const clientFinancePermissions = [
      'billing:read',
      'client:read',
      'contact:read',
      'credit:read',
      'document:read',
      'invoice:read',
      'profile:read',
      'user_settings:read', 'user_settings:update'
    ];

    for (const permKey of clientFinancePermissions) {
      const permId = permissionMap.get(permKey);
      if (permId) {
        await assignPermissionToRole(tenant, clientFinanceRole.role_id, permId);
      }
    }

    // Client User - Basic access
    const clientUserPermissions = [
      'asset:read',
      'contact:create', 'contact:read', 'contact:update',
      'document:create', 'document:read',
      'profile:read', 'profile:update',
      'project:read',
      'tag:read',
      'ticket:create', 'ticket:read', 'ticket:update',
      'user_settings:read', 'user_settings:update',
      'user:read'  // Can see other users but not manage them
    ];

    for (const permKey of clientUserPermissions) {
      const permId = permissionMap.get(permKey);
      if (permId) {
        await assignPermissionToRole(tenant, clientUserRole.role_id, permId);
      }
    }
  }
  
  // Clean up deprecated permissions
  console.log('Removing deprecated permissions...');
  
  // Resources to completely remove
  const deprecatedResources = ['category', 'comment', 'client_password', 'client_profile', 'company_setting'];
  
  for (const resource of deprecatedResources) {
    // First remove any role_permissions assignments
    await knex('role_permissions')
      .whereIn('permission_id', function() {
        this.select('permission_id')
          .from('permissions')
          .where('resource', resource);
      })
      .delete();
    
    // Then remove the permissions themselves
    const deletedCount = await knex('permissions')
      .where('resource', resource)
      .delete();
      
    if (deletedCount > 0) {
      console.log(`Removed ${deletedCount} deprecated ${resource} permissions`);
    }
  }
  
  // Update existing permissions to restrict client portal access
  console.log('Updating client portal permissions to match security requirements...');
  
  // Resources that should NOT be available to client portal
  const mspOnlyResources = [
    'asset', 'billing', 'client', 'contact', 'credit', 'invoice', 
    'profile', 'tag', 'priority', 'notification'
  ];
  
  // Update these resources to be MSP-only
  for (const resource of mspOnlyResources) {
    const updated = await knex('permissions')
      .where('resource', resource)
      .where('client', true)
      .update({ client: false });
      
    if (updated > 0) {
      console.log(`Updated ${updated} ${resource} permissions to be MSP-only`);
    }
  }
  
  // Ensure the 5 allowed resources have correct permissions for client portal
  // These are: user, ticket, project (read-only), company (read/update), document
  const clientAllowedUpdates = [
    { resource: 'project', actions: ['read'] },
    { resource: 'company', actions: ['read', 'update'] }
  ];
  
  for (const { resource, actions } of clientAllowedUpdates) {
    const updated = await knex('permissions')
      .where('resource', resource)
      .whereIn('action', actions)
      .where('client', false)
      .update({ client: true });
      
    if (updated > 0) {
      console.log(`Updated ${updated} ${resource} permissions to be available in client portal`);
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function() {
  // This migration is designed to be idempotent and only updates existing data
  // Rolling back would require removing the msp/client columns which is handled by the schema migration
  // No specific rollback needed for the data updates
};