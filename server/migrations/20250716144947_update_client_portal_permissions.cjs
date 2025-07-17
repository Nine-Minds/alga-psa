exports.up = async function(knex) {
  // Get all tenants
  const tenants = await knex('tenants').pluck('tenant');
  
  console.log(`Updating permissions for ${tenants.length} tenants`);
  
  for (const tenant of tenants) {
    // Step 1: Delete all role permissions for this tenant
    console.log(`Removing all role permissions for tenant ${tenant}`);
    await knex('role_permissions').where({ tenant }).delete();
    
    // Step 2: Delete all permissions for this tenant
    console.log(`Removing all permissions for tenant ${tenant}`);
    await knex('permissions').where({ tenant }).delete();
    
    // Step 3: Remove user assignments for roles that will be deleted
    console.log(`Removing user role assignments for unwanted roles in tenant ${tenant}`);
    const rolesToDelete = await knex('roles')
      .where({ tenant })
      .where(function() {
        this.where({ role_name: 'Manager', msp: true });
      })
      .select('role_id');
    
    if (rolesToDelete.length > 0) {
      const roleIds = rolesToDelete.map(r => r.role_id);
      await knex('user_roles')
        .where({ tenant })
        .whereIn('role_id', roleIds)
        .delete();
      console.log(`Removed user role assignments for ${roleIds.length} roles`);
    }
    
    // Step 4: Remove unwanted roles
    console.log(`Removing unwanted roles for tenant ${tenant}`);
    await knex('roles')
      .where({ tenant })
      .where(function() {
        this.where({ role_name: 'Manager', msp: true });
      })
      .delete();
    
    // Step 5: Create all permissions from permissions_list.md
    console.log(`Creating permissions for tenant ${tenant}`);
    const allPermissions = [
      // MSP permissions
      // Asset permissions
      { tenant, resource: 'asset', action: 'create', msp: true, client: false, description: 'Create assets' },
      { tenant, resource: 'asset', action: 'read', msp: true, client: false, description: 'View assets' },
      { tenant, resource: 'asset', action: 'update', msp: true, client: false, description: 'Update assets' },
      { tenant, resource: 'asset', action: 'delete', msp: true, client: false, description: 'Delete assets' },
      
      // Billing permissions
      { tenant, resource: 'billing', action: 'create', msp: true, client: false, description: 'Create billing records' },
      { tenant, resource: 'billing', action: 'read', msp: true, client: false, description: 'View billing information' },
      { tenant, resource: 'billing', action: 'update', msp: true, client: false, description: 'Update billing records' },
      { tenant, resource: 'billing', action: 'delete', msp: true, client: false, description: 'Delete billing records' },
      
      // Client permissions
      { tenant, resource: 'client', action: 'create', msp: true, client: false, description: 'Create clients' },
      { tenant, resource: 'client', action: 'read', msp: true, client: false, description: 'View clients' },
      { tenant, resource: 'client', action: 'update', msp: true, client: false, description: 'Update clients' },
      { tenant, resource: 'client', action: 'delete', msp: true, client: false, description: 'Delete clients' },
      
      // Contact permissions
      { tenant, resource: 'contact', action: 'create', msp: true, client: false, description: 'Create contacts' },
      { tenant, resource: 'contact', action: 'read', msp: true, client: false, description: 'View contacts' },
      { tenant, resource: 'contact', action: 'update', msp: true, client: false, description: 'Update contacts' },
      { tenant, resource: 'contact', action: 'delete', msp: true, client: false, description: 'Delete contacts' },
      
      // Credit permissions
      { tenant, resource: 'credit', action: 'create', msp: true, client: false, description: 'Create credits' },
      { tenant, resource: 'credit', action: 'read', msp: true, client: false, description: 'View credits' },
      { tenant, resource: 'credit', action: 'update', msp: true, client: false, description: 'Update credits' },
      { tenant, resource: 'credit', action: 'delete', msp: true, client: false, description: 'Delete credits' },
      { tenant, resource: 'credit', action: 'transfer', msp: true, client: false, description: 'Transfer credits' },
      { tenant, resource: 'credit', action: 'reconcile', msp: true, client: false, description: 'Reconcile credits' },
      
      // Document permissions
      { tenant, resource: 'document', action: 'create', msp: true, client: false, description: 'Create documents' },
      { tenant, resource: 'document', action: 'read', msp: true, client: false, description: 'View documents' },
      { tenant, resource: 'document', action: 'update', msp: true, client: false, description: 'Update documents' },
      { tenant, resource: 'document', action: 'delete', msp: true, client: false, description: 'Delete documents' },
      
      // Invoice permissions
      { tenant, resource: 'invoice', action: 'create', msp: true, client: false, description: 'Create invoices' },
      { tenant, resource: 'invoice', action: 'read', msp: true, client: false, description: 'View invoices' },
      { tenant, resource: 'invoice', action: 'update', msp: true, client: false, description: 'Update invoices' },
      { tenant, resource: 'invoice', action: 'delete', msp: true, client: false, description: 'Delete invoices' },
      { tenant, resource: 'invoice', action: 'generate', msp: true, client: false, description: 'Generate invoices' },
      { tenant, resource: 'invoice', action: 'finalize', msp: true, client: false, description: 'Finalize invoices' },
      { tenant, resource: 'invoice', action: 'send', msp: true, client: false, description: 'Send invoices' },
      { tenant, resource: 'invoice', action: 'void', msp: true, client: false, description: 'Void invoices' },
      
      // Profile permissions
      { tenant, resource: 'profile', action: 'create', msp: true, client: false, description: 'Create profiles' },
      { tenant, resource: 'profile', action: 'read', msp: true, client: false, description: 'View profiles' },
      { tenant, resource: 'profile', action: 'update', msp: true, client: false, description: 'Update profiles' },
      { tenant, resource: 'profile', action: 'delete', msp: true, client: false, description: 'Delete profiles' },
      
      // Project permissions
      { tenant, resource: 'project', action: 'create', msp: true, client: false, description: 'Create projects' },
      { tenant, resource: 'project', action: 'read', msp: true, client: false, description: 'View projects' },
      { tenant, resource: 'project', action: 'update', msp: true, client: false, description: 'Update projects' },
      { tenant, resource: 'project', action: 'delete', msp: true, client: false, description: 'Delete projects' },
      
      // Project task permissions
      { tenant, resource: 'project_task', action: 'create', msp: true, client: false, description: 'Create project tasks' },
      { tenant, resource: 'project_task', action: 'read', msp: true, client: false, description: 'View project tasks' },
      { tenant, resource: 'project_task', action: 'update', msp: true, client: false, description: 'Update project tasks' },
      { tenant, resource: 'project_task', action: 'delete', msp: true, client: false, description: 'Delete project tasks' },
      
      // Tag permissions
      { tenant, resource: 'tag', action: 'create', msp: true, client: false, description: 'Create tags' },
      { tenant, resource: 'tag', action: 'read', msp: true, client: false, description: 'View tags' },
      { tenant, resource: 'tag', action: 'update', msp: true, client: false, description: 'Update tags' },
      { tenant, resource: 'tag', action: 'delete', msp: true, client: false, description: 'Delete tags' },
      
      // Technician dispatch permissions
      { tenant, resource: 'technician_dispatch', action: 'create', msp: true, client: false, description: 'Create dispatch entries' },
      { tenant, resource: 'technician_dispatch', action: 'read', msp: true, client: false, description: 'View dispatch entries' },
      { tenant, resource: 'technician_dispatch', action: 'update', msp: true, client: false, description: 'Update dispatch entries' },
      { tenant, resource: 'technician_dispatch', action: 'delete', msp: true, client: false, description: 'Delete dispatch entries' },
      
      // Ticket permissions
      { tenant, resource: 'ticket', action: 'create', msp: true, client: false, description: 'Create tickets' },
      { tenant, resource: 'ticket', action: 'read', msp: true, client: false, description: 'View tickets' },
      { tenant, resource: 'ticket', action: 'update', msp: true, client: false, description: 'Update tickets' },
      { tenant, resource: 'ticket', action: 'delete', msp: true, client: false, description: 'Delete tickets' },
      
      // Time entry permissions
      { tenant, resource: 'timeentry', action: 'create', msp: true, client: false, description: 'Create time entries' },
      { tenant, resource: 'timeentry', action: 'read', msp: true, client: false, description: 'View time entries' },
      { tenant, resource: 'timeentry', action: 'update', msp: true, client: false, description: 'Update time entries' },
      { tenant, resource: 'timeentry', action: 'delete', msp: true, client: false, description: 'Delete time entries' },
      
      // Timesheet permissions
      { tenant, resource: 'timesheet', action: 'create', msp: true, client: false, description: 'Create timesheets' },
      { tenant, resource: 'timesheet', action: 'read', msp: true, client: false, description: 'View timesheets' },
      { tenant, resource: 'timesheet', action: 'update', msp: true, client: false, description: 'Update timesheets' },
      { tenant, resource: 'timesheet', action: 'delete', msp: true, client: false, description: 'Delete timesheets' },
      { tenant, resource: 'timesheet', action: 'read_all', msp: true, client: false, description: 'View all timesheets' },
      { tenant, resource: 'timesheet', action: 'submit', msp: true, client: false, description: 'Submit timesheets' },
      { tenant, resource: 'timesheet', action: 'approve', msp: true, client: false, description: 'Approve timesheets' },
      { tenant, resource: 'timesheet', action: 'reverse', msp: true, client: false, description: 'Reverse timesheet approvals' },
      
      // User permissions
      { tenant, resource: 'user', action: 'create', msp: true, client: false, description: 'Create users' },
      { tenant, resource: 'user', action: 'read', msp: true, client: false, description: 'View users' },
      { tenant, resource: 'user', action: 'update', msp: true, client: false, description: 'Update users' },
      { tenant, resource: 'user', action: 'delete', msp: true, client: false, description: 'Delete users' },
      { tenant, resource: 'user', action: 'invite', msp: true, client: false, description: 'Invite users' },
      { tenant, resource: 'user', action: 'reset_password', msp: true, client: false, description: 'Reset user passwords' },
      
      // User schedule permissions
      { tenant, resource: 'user_schedule', action: 'create', msp: true, client: false, description: 'Create user schedules' },
      { tenant, resource: 'user_schedule', action: 'read', msp: true, client: false, description: 'View user schedules' },
      { tenant, resource: 'user_schedule', action: 'update', msp: true, client: false, description: 'Update user schedules' },
      { tenant, resource: 'user_schedule', action: 'delete', msp: true, client: false, description: 'Delete user schedules' },
      
      // Settings permissions
      { tenant, resource: 'ticket_settings', action: 'create', msp: true, client: false, description: 'Create ticket settings' },
      { tenant, resource: 'ticket_settings', action: 'read', msp: true, client: false, description: 'View ticket settings' },
      { tenant, resource: 'ticket_settings', action: 'update', msp: true, client: false, description: 'Update ticket settings' },
      { tenant, resource: 'ticket_settings', action: 'delete', msp: true, client: false, description: 'Delete ticket settings' },
      
      { tenant, resource: 'user_settings', action: 'create', msp: true, client: false, description: 'Create user settings' },
      { tenant, resource: 'user_settings', action: 'read', msp: true, client: false, description: 'View user settings' },
      { tenant, resource: 'user_settings', action: 'update', msp: true, client: false, description: 'Update user settings' },
      { tenant, resource: 'user_settings', action: 'delete', msp: true, client: false, description: 'Delete user settings' },
      
      { tenant, resource: 'system_settings', action: 'create', msp: true, client: false, description: 'Create system settings' },
      { tenant, resource: 'system_settings', action: 'read', msp: true, client: false, description: 'View system settings' },
      { tenant, resource: 'system_settings', action: 'update', msp: true, client: false, description: 'Update system settings' },
      { tenant, resource: 'system_settings', action: 'delete', msp: true, client: false, description: 'Delete system settings' },
      
      { tenant, resource: 'security_settings', action: 'create', msp: true, client: false, description: 'Create security settings' },
      { tenant, resource: 'security_settings', action: 'read', msp: true, client: false, description: 'View security settings' },
      { tenant, resource: 'security_settings', action: 'update', msp: true, client: false, description: 'Update security settings' },
      { tenant, resource: 'security_settings', action: 'delete', msp: true, client: false, description: 'Delete security settings' },
      
      { tenant, resource: 'timeentry_settings', action: 'create', msp: true, client: false, description: 'Create time entry settings' },
      { tenant, resource: 'timeentry_settings', action: 'read', msp: true, client: false, description: 'View time entry settings' },
      { tenant, resource: 'timeentry_settings', action: 'update', msp: true, client: false, description: 'Update time entry settings' },
      { tenant, resource: 'timeentry_settings', action: 'delete', msp: true, client: false, description: 'Delete time entry settings' },
      
      { tenant, resource: 'billing_settings', action: 'create', msp: true, client: false, description: 'Create billing settings' },
      { tenant, resource: 'billing_settings', action: 'read', msp: true, client: false, description: 'View billing settings' },
      { tenant, resource: 'billing_settings', action: 'update', msp: true, client: false, description: 'Update billing settings' },
      { tenant, resource: 'billing_settings', action: 'delete', msp: true, client: false, description: 'Delete billing settings' },
      
      // Client portal permissions
      { tenant, resource: 'billing', action: 'read', msp: false, client: true, description: 'View billing information in client portal' },
      { tenant, resource: 'billing', action: 'create', msp: false, client: true, description: 'Create billing entries in client portal' },
      { tenant, resource: 'billing', action: 'update', msp: false, client: true, description: 'Update billing entries in client portal' },
      
      { tenant, resource: 'client', action: 'read', msp: false, client: true, description: 'View client information' },
      { tenant, resource: 'client', action: 'create', msp: false, client: true, description: 'Create client information' },
      { tenant, resource: 'client', action: 'update', msp: false, client: true, description: 'Update client information' },
      { tenant, resource: 'client', action: 'delete', msp: false, client: true, description: 'Delete client information' },
      
      { tenant, resource: 'project', action: 'read', msp: false, client: true, description: 'View projects in client portal' },
      { tenant, resource: 'project', action: 'create', msp: false, client: true, description: 'Create projects in client portal' },
      { tenant, resource: 'project', action: 'update', msp: false, client: true, description: 'Update projects in client portal' },
      { tenant, resource: 'project', action: 'delete', msp: false, client: true, description: 'Delete projects in client portal' },
      
      { tenant, resource: 'ticket', action: 'read', msp: false, client: true, description: 'View tickets in client portal' },
      { tenant, resource: 'ticket', action: 'create', msp: false, client: true, description: 'Create tickets in client portal' },
      { tenant, resource: 'ticket', action: 'update', msp: false, client: true, description: 'Update tickets in client portal' },
      
      { tenant, resource: 'time_management', action: 'read', msp: false, client: true, description: 'View time management in client portal' },
      { tenant, resource: 'time_management', action: 'create', msp: false, client: true, description: 'Create time entries in client portal' },
      { tenant, resource: 'time_management', action: 'update', msp: false, client: true, description: 'Update time entries in client portal' },
      { tenant, resource: 'time_management', action: 'delete', msp: false, client: true, description: 'Delete time entries in client portal' },
      
      { tenant, resource: 'user', action: 'read', msp: false, client: true, description: 'View users in client portal' },
      { tenant, resource: 'user', action: 'create', msp: false, client: true, description: 'Create users in client portal' },
      { tenant, resource: 'user', action: 'update', msp: false, client: true, description: 'Update users in client portal' },
      { tenant, resource: 'user', action: 'delete', msp: false, client: true, description: 'Delete users in client portal' },
      { tenant, resource: 'user', action: 'reset_password', msp: false, client: true, description: 'Reset passwords in client portal' },
      
      { tenant, resource: 'settings', action: 'read', msp: false, client: true, description: 'View settings in client portal' },
      { tenant, resource: 'settings', action: 'create', msp: false, client: true, description: 'Create settings in client portal' },
      { tenant, resource: 'settings', action: 'update', msp: false, client: true, description: 'Update settings in client portal' },
      { tenant, resource: 'settings', action: 'delete', msp: false, client: true, description: 'Delete settings in client portal' },
      
      { tenant, resource: 'documents', action: 'read', msp: false, client: true, description: 'View documents in client portal' },
      { tenant, resource: 'documents', action: 'create', msp: false, client: true, description: 'Create documents in client portal' },
      { tenant, resource: 'documents', action: 'update', msp: false, client: true, description: 'Update documents in client portal' }
    ];
    
    // Insert all permissions
    await knex('permissions').insert(allPermissions);
    console.log(`Created ${allPermissions.length} permissions for tenant ${tenant}`);
    
    // Step 6: Get all roles for mapping
    const roles = await knex('roles').where({ tenant });
    const roleMap = {};
    roles.forEach(role => {
      const key = `${role.msp ? 'msp' : 'client'}_${role.role_name.toLowerCase()}`;
      roleMap[key] = role;
    });
    
    // Step 7: Assign permissions to roles according to permissions_list.md
    
    // MSP Admin gets all MSP permissions
    if (roleMap.msp_admin) {
      const mspPermissions = await knex('permissions')
        .where({ tenant, msp: true })
        .pluck('permission_id');
      
      const adminRolePerms = mspPermissions.map(permission_id => ({
        tenant,
        role_id: roleMap.msp_admin.role_id,
        permission_id
      }));
      
      if (adminRolePerms.length > 0) {
        await knex('role_permissions').insert(adminRolePerms);
        console.log(`Assigned ${adminRolePerms.length} permissions to MSP Admin role`);
      }
    }
    
    // MSP Finance permissions
    if (roleMap.msp_finance) {
      const financePermissions = {
        asset: ['read'],
        billing: ['create', 'read', 'update', 'delete'],
        client: ['create', 'read', 'update', 'delete'],
        contact: ['create', 'read', 'update', 'delete'],
        credit: ['create', 'read', 'update', 'delete', 'transfer', 'reconcile'],
        document: ['create', 'read', 'update', 'delete'],
        invoice: ['create', 'read', 'update', 'delete', 'generate', 'finalize', 'send', 'void'],
        profile: ['create', 'read', 'update'],
        project: ['read', 'update'],
        project_task: ['read', 'update'],
        tag: ['create', 'read'],
        technician_dispatch: ['read'],
        ticket: ['read', 'update'],
        timeentry: ['create', 'read', 'update', 'delete'],
        timesheet: ['read', 'read_all', 'submit'],
        user: ['read'],
        user_schedule: ['read'],
        billing_settings: ['create', 'read', 'update', 'delete']
      };
      
      const financeRolePerms = [];
      for (const [resource, actions] of Object.entries(financePermissions)) {
        for (const action of actions) {
          const permission = await knex('permissions')
            .where({ tenant, resource, action, msp: true })
            .first();
          if (permission) {
            financeRolePerms.push({
              tenant,
              role_id: roleMap.msp_finance.role_id,
              permission_id: permission.permission_id
            });
          }
        }
      }
      
      if (financeRolePerms.length > 0) {
        await knex('role_permissions').insert(financeRolePerms);
        console.log(`Assigned ${financeRolePerms.length} permissions to MSP Finance role`);
      }
    }
    
    // MSP Technician permissions
    if (roleMap.msp_technician) {
      const technicianPermissions = {
        asset: ['create', 'read', 'update'],
        client: ['read', 'delete'],
        contact: ['read', 'delete'],
        document: ['create', 'read', 'update'],
        profile: ['read', 'update'],
        project: ['read'],
        project_task: ['create', 'read', 'update'],
        tag: ['create', 'read', 'update'],
        technician_dispatch: ['read'],
        ticket: ['create', 'read', 'update'],
        timeentry: ['create', 'read', 'update'],
        timesheet: ['read', 'update', 'read_all', 'submit'],
        user_schedule: ['read'],
        ticket_settings: ['read']
      };
      
      const technicianRolePerms = [];
      for (const [resource, actions] of Object.entries(technicianPermissions)) {
        for (const action of actions) {
          const permission = await knex('permissions')
            .where({ tenant, resource, action, msp: true })
            .first();
          if (permission) {
            technicianRolePerms.push({
              tenant,
              role_id: roleMap.msp_technician.role_id,
              permission_id: permission.permission_id
            });
          }
        }
      }
      
      if (technicianRolePerms.length > 0) {
        await knex('role_permissions').insert(technicianRolePerms);
        console.log(`Assigned ${technicianRolePerms.length} permissions to MSP Technician role`);
      }
    }
    
    // MSP Project Manager permissions
    if (roleMap.msp_project_manager) {
      const projectManagerPermissions = {
        asset: ['read'],
        billing: ['read'],
        client: ['create', 'read', 'update'],
        contact: ['create', 'read', 'update'],
        document: ['create', 'read', 'update'],
        invoice: ['read'],
        profile: ['read', 'update'],
        project: ['create', 'read', 'update', 'delete'],
        project_task: ['create', 'read', 'update', 'delete'],
        tag: ['create', 'read', 'update'],
        technician_dispatch: ['read'],
        ticket: ['create', 'read', 'update'],
        timeentry: ['create', 'read', 'update'],
        timesheet: ['read', 'update', 'read_all', 'submit', 'approve', 'reverse'],
        user: ['read', 'invite'],
        user_schedule: ['read'],
        user_settings: ['read'],
        billing_settings: ['read']
      };
      
      const pmRolePerms = [];
      for (const [resource, actions] of Object.entries(projectManagerPermissions)) {
        for (const action of actions) {
          const permission = await knex('permissions')
            .where({ tenant, resource, action, msp: true })
            .first();
          if (permission) {
            pmRolePerms.push({
              tenant,
              role_id: roleMap.msp_project_manager.role_id,
              permission_id: permission.permission_id
            });
          }
        }
      }
      
      if (pmRolePerms.length > 0) {
        await knex('role_permissions').insert(pmRolePerms);
        console.log(`Assigned ${pmRolePerms.length} permissions to MSP Project Manager role`);
      }
    }
    
    // MSP Dispatcher permissions
    if (roleMap.msp_dispatcher) {
      const dispatcherPermissions = {
        asset: ['read'],
        client: ['read'],
        contact: ['read'],
        document: ['read'],
        profile: ['read'],
        project: ['read'],
        project_task: ['read'],
        tag: ['create', 'read', 'update'],
        technician_dispatch: ['create', 'read', 'update'],
        ticket: ['create', 'read', 'update'],
        timeentry: ['read'],
        timesheet: ['read'],
        user: ['read'],
        user_schedule: ['create', 'read', 'update'],
        user_settings: ['read']
      };
      
      const dispatcherRolePerms = [];
      for (const [resource, actions] of Object.entries(dispatcherPermissions)) {
        for (const action of actions) {
          const permission = await knex('permissions')
            .where({ tenant, resource, action, msp: true })
            .first();
          if (permission) {
            dispatcherRolePerms.push({
              tenant,
              role_id: roleMap.msp_dispatcher.role_id,
              permission_id: permission.permission_id
            });
          }
        }
      }
      
      if (dispatcherRolePerms.length > 0) {
        await knex('role_permissions').insert(dispatcherRolePerms);
        console.log(`Assigned ${dispatcherRolePerms.length} permissions to MSP Dispatcher role`);
      }
    }
    
    // Client Portal Admin permissions (role name is 'Admin' with client=true)
    const clientAdminRole = roles.find(r => r.role_name === 'Admin' && r.client === true && r.msp === false);
    if (clientAdminRole) {
      const clientAdminPermissions = {
        billing: ['create', 'read', 'update'],
        client: ['create', 'read', 'update', 'delete'],
        project: ['create', 'read', 'update', 'delete'],
        ticket: ['create', 'read', 'update'],
        time_management: ['create', 'read', 'update', 'delete'],
        user: ['create', 'read', 'update', 'delete', 'reset_password'],
        settings: ['create', 'read', 'update', 'delete'],
        documents: ['create', 'read', 'update']
      };
      
      const clientAdminRolePerms = [];
      for (const [resource, actions] of Object.entries(clientAdminPermissions)) {
        for (const action of actions) {
          const permission = await knex('permissions')
            .where({ tenant, resource, action, msp: false, client: true })
            .first();
          if (permission) {
            clientAdminRolePerms.push({
              tenant,
              role_id: clientAdminRole.role_id,
              permission_id: permission.permission_id
            });
          }
        }
      }
      
      if (clientAdminRolePerms.length > 0) {
        await knex('role_permissions').insert(clientAdminRolePerms);
        console.log(`Assigned ${clientAdminRolePerms.length} permissions to Client Admin role`);
      }
    }
    
    // Client Finance permissions  
    const clientFinanceRole = roles.find(r => r.role_name === 'Finance' && r.client === true && r.msp === false);
    if (clientFinanceRole) {
      const clientFinancePermissions = {
        billing: ['read'],
        client: ['create', 'read', 'update'],
        project: ['read'],
        ticket: ['create', 'read', 'update'],
        time_management: ['read'],
        user: ['read'],
        settings: ['read'],
        documents: ['create', 'read', 'update']
      };
      
      const clientFinanceRolePerms = [];
      for (const [resource, actions] of Object.entries(clientFinancePermissions)) {
        for (const action of actions) {
          const permission = await knex('permissions')
            .where({ tenant, resource, action, msp: false, client: true })
            .first();
          if (permission) {
            clientFinanceRolePerms.push({
              tenant,
              role_id: clientFinanceRole.role_id,
              permission_id: permission.permission_id
            });
          }
        }
      }
      
      if (clientFinanceRolePerms.length > 0) {
        await knex('role_permissions').insert(clientFinanceRolePerms);
        console.log(`Assigned ${clientFinanceRolePerms.length} permissions to Client Finance role`);
      }
    }
    
    // Client User permissions
    const clientUserRole = roles.find(r => r.role_name === 'User' && r.client === true && r.msp === false);
    if (clientUserRole) {
      const clientUserPermissions = {
        client: ['create', 'read', 'update'],
        project: ['read'],
        ticket: ['create', 'read', 'update'],
        time_management: ['read'],
        documents: ['create', 'read', 'update']
      };
      
      const clientUserRolePerms = [];
      for (const [resource, actions] of Object.entries(clientUserPermissions)) {
        for (const action of actions) {
          const permission = await knex('permissions')
            .where({ tenant, resource, action, msp: false, client: true })
            .first();
          if (permission) {
            clientUserRolePerms.push({
              tenant,
              role_id: clientUserRole.role_id,
              permission_id: permission.permission_id
            });
          }
        }
      }
      
      if (clientUserRolePerms.length > 0) {
        await knex('role_permissions').insert(clientUserRolePerms);
        console.log(`Assigned ${clientUserRolePerms.length} permissions to Client User role`);
      }
    }
    
  }
  
  console.log('Permission updates completed');
};

exports.down = async function() {
  // This is a complete reset migration, so the down migration 
  // cannot restore the exact previous state. It will just log a warning.
  console.log('WARNING: This migration performed a complete permissions reset.');
  console.log('The down migration cannot restore the previous state.');
  console.log('Manual intervention may be required to restore permissions.');
};