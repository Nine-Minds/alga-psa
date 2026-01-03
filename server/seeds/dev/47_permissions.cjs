exports.seed = async function(knex) {
    // Get all tenants
    const tenants = await knex('tenants').select('tenant');
    if (!tenants.length) return;

    // Define all permissions exactly as specified in permissions_list.md
    const allPermissions = [
        // MSP Permissions
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
        
        // Credit permissions
        { resource: 'credit', action: 'create', msp: true, client: false, description: 'Create credits' },
        { resource: 'credit', action: 'read', msp: true, client: false, description: 'View credits' },
        { resource: 'credit', action: 'update', msp: true, client: false, description: 'Update credits' },
        { resource: 'credit', action: 'delete', msp: true, client: false, description: 'Delete credits' },
        { resource: 'credit', action: 'transfer', msp: true, client: false, description: 'Transfer credits' },
        { resource: 'credit', action: 'reconcile', msp: true, client: false, description: 'Reconcile credits' },
        
        // Document permissions
        { resource: 'document', action: 'create', msp: true, client: false, description: 'Create documents' },
        { resource: 'document', action: 'read', msp: true, client: false, description: 'View documents' },
        { resource: 'document', action: 'update', msp: true, client: false, description: 'Update documents' },
        { resource: 'document', action: 'delete', msp: true, client: false, description: 'Delete documents' },

        // Extension permissions
        { resource: 'extension', action: 'read', msp: true, client: false, description: 'Read extension APIs and storage' },
        { resource: 'extension', action: 'write', msp: true, client: false, description: 'Write extension APIs and storage' },
        
        // Invoice permissions
        { resource: 'invoice', action: 'create', msp: true, client: false, description: 'Create invoices' },
        { resource: 'invoice', action: 'read', msp: true, client: false, description: 'View invoices' },
        { resource: 'invoice', action: 'update', msp: true, client: false, description: 'Update invoices' },
        { resource: 'invoice', action: 'delete', msp: true, client: false, description: 'Delete invoices' },
        { resource: 'invoice', action: 'generate', msp: true, client: false, description: 'Generate invoices' },
        { resource: 'invoice', action: 'finalize', msp: true, client: false, description: 'Finalize invoices' },
        { resource: 'invoice', action: 'send', msp: true, client: false, description: 'Send invoices' },
        { resource: 'invoice', action: 'void', msp: true, client: false, description: 'Void invoices' },
        
        // Profile permissions
        { resource: 'profile', action: 'create', msp: true, client: false, description: 'Create profiles' },
        { resource: 'profile', action: 'read', msp: true, client: false, description: 'View profiles' },
        { resource: 'profile', action: 'update', msp: true, client: false, description: 'Update profiles' },
        { resource: 'profile', action: 'delete', msp: true, client: false, description: 'Delete profiles' },
        
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
        
        // Tag permissions
        { resource: 'tag', action: 'create', msp: true, client: false, description: 'Create tags' },
        { resource: 'tag', action: 'read', msp: true, client: false, description: 'View tags' },
        { resource: 'tag', action: 'update', msp: true, client: false, description: 'Update tags' },
        { resource: 'tag', action: 'delete', msp: true, client: false, description: 'Delete tags' },
        
        // Technician dispatch permissions
        { resource: 'technician_dispatch', action: 'create', msp: true, client: false, description: 'Create dispatch entries' },
        { resource: 'technician_dispatch', action: 'read', msp: true, client: false, description: 'View dispatch entries' },
        { resource: 'technician_dispatch', action: 'update', msp: true, client: false, description: 'Update dispatch entries' },
        { resource: 'technician_dispatch', action: 'delete', msp: true, client: false, description: 'Delete dispatch entries' },
        
        // Ticket permissions
        { resource: 'ticket', action: 'create', msp: true, client: false, description: 'Create tickets' },
        { resource: 'ticket', action: 'read', msp: true, client: false, description: 'View tickets' },
        { resource: 'ticket', action: 'update', msp: true, client: false, description: 'Update tickets' },
        { resource: 'ticket', action: 'delete', msp: true, client: false, description: 'Delete tickets' },
        
        // Time entry permissions
        { resource: 'timeentry', action: 'create', msp: true, client: false, description: 'Create time entries' },
        { resource: 'timeentry', action: 'read', msp: true, client: false, description: 'View time entries' },
        { resource: 'timeentry', action: 'update', msp: true, client: false, description: 'Update time entries' },
        { resource: 'timeentry', action: 'delete', msp: true, client: false, description: 'Delete time entries' },
        
        // Timesheet permissions
        { resource: 'timesheet', action: 'create', msp: true, client: false, description: 'Create timesheets' },
        { resource: 'timesheet', action: 'read', msp: true, client: false, description: 'View timesheets' },
        { resource: 'timesheet', action: 'update', msp: true, client: false, description: 'Update timesheets' },
        { resource: 'timesheet', action: 'delete', msp: true, client: false, description: 'Delete timesheets' },
        { resource: 'timesheet', action: 'read_all', msp: true, client: false, description: 'View all timesheets' },
        { resource: 'timesheet', action: 'submit', msp: true, client: false, description: 'Submit timesheets' },
        { resource: 'timesheet', action: 'approve', msp: true, client: false, description: 'Approve timesheets' },
        { resource: 'timesheet', action: 'reverse', msp: true, client: false, description: 'Reverse timesheet approvals' },
        
        // User permissions
        { resource: 'user', action: 'create', msp: true, client: false, description: 'Create users' },
        { resource: 'user', action: 'read', msp: true, client: false, description: 'View users' },
        { resource: 'user', action: 'update', msp: true, client: false, description: 'Update users' },
        { resource: 'user', action: 'delete', msp: true, client: false, description: 'Delete users' },
        { resource: 'user', action: 'invite', msp: true, client: false, description: 'Invite users' },
        { resource: 'user', action: 'reset_password', msp: true, client: false, description: 'Reset user passwords' },
        
        // User schedule permissions
        { resource: 'user_schedule', action: 'create', msp: true, client: false, description: 'Create user schedules' },
        { resource: 'user_schedule', action: 'read', msp: true, client: false, description: 'View user schedules' },
        { resource: 'user_schedule', action: 'update', msp: true, client: false, description: 'Update user schedules' },
        { resource: 'user_schedule', action: 'delete', msp: true, client: false, description: 'Delete user schedules' },
        
        // Settings permissions
        { resource: 'ticket_settings', action: 'create', msp: true, client: false, description: 'Create ticket settings' },
        { resource: 'ticket_settings', action: 'read', msp: true, client: false, description: 'View ticket settings' },
        { resource: 'ticket_settings', action: 'update', msp: true, client: false, description: 'Update ticket settings' },
        { resource: 'ticket_settings', action: 'delete', msp: true, client: false, description: 'Delete ticket settings' },
        
        { resource: 'user_settings', action: 'create', msp: true, client: false, description: 'Create user settings' },
        { resource: 'user_settings', action: 'read', msp: true, client: false, description: 'View user settings' },
        { resource: 'user_settings', action: 'update', msp: true, client: false, description: 'Update user settings' },
        { resource: 'user_settings', action: 'delete', msp: true, client: false, description: 'Delete user settings' },
        
        { resource: 'system_settings', action: 'create', msp: true, client: false, description: 'Create system settings' },
        { resource: 'system_settings', action: 'read', msp: true, client: false, description: 'View system settings' },
        { resource: 'system_settings', action: 'update', msp: true, client: false, description: 'Update system settings' },
        { resource: 'system_settings', action: 'delete', msp: true, client: false, description: 'Delete system settings' },
        
        { resource: 'security_settings', action: 'create', msp: true, client: false, description: 'Create security settings' },
        { resource: 'security_settings', action: 'read', msp: true, client: false, description: 'View security settings' },
        { resource: 'security_settings', action: 'update', msp: true, client: false, description: 'Update security settings' },
        { resource: 'security_settings', action: 'delete', msp: true, client: false, description: 'Delete security settings' },
        
        { resource: 'timeentry_settings', action: 'create', msp: true, client: false, description: 'Create time entry settings' },
        { resource: 'timeentry_settings', action: 'read', msp: true, client: false, description: 'View time entry settings' },
        { resource: 'timeentry_settings', action: 'update', msp: true, client: false, description: 'Update time entry settings' },
        { resource: 'timeentry_settings', action: 'delete', msp: true, client: false, description: 'Delete time entry settings' },
        
        { resource: 'billing_settings', action: 'create', msp: true, client: false, description: 'Create billing settings' },
        { resource: 'billing_settings', action: 'read', msp: true, client: false, description: 'View billing settings' },
        { resource: 'billing_settings', action: 'update', msp: true, client: false, description: 'Update billing settings' },
        { resource: 'billing_settings', action: 'delete', msp: true, client: false, description: 'Delete billing settings' },

        // Account Management permissions - MSP Admin only
        { resource: 'account_management', action: 'read', msp: true, client: false, description: 'View account and subscription details' },
        { resource: 'account_management', action: 'update', msp: true, client: false, description: 'Manage account and subscription settings' },
        { resource: 'account_management', action: 'delete', msp: true, client: false, description: 'Cancel subscription and delete account' },

        // both the MSP and Client have their own settings, but share the same permission structure
        { resource: 'settings', action: 'read', msp: true, client: true, description: 'View portal settings' },
        { resource: 'settings', action: 'create', msp: true, client: true, description: 'Create portal settings' },
        { resource: 'settings', action: 'update', msp: true, client: true, description: 'Manage portal settings' },
        { resource: 'settings', action: 'delete', msp: true, client: true, description: 'Delete portal settings' },
        
        // Client Portal Permissions
        { resource: 'billing', action: 'read', msp: false, client: true, description: 'View billing information in client portal' },
        { resource: 'billing', action: 'create', msp: false, client: true, description: 'Create billing entries in client portal' },
        { resource: 'billing', action: 'update', msp: false, client: true, description: 'Update billing entries in client portal' },
        
        { resource: 'client', action: 'read', msp: false, client: true, description: 'View client information' },
        { resource: 'client', action: 'create', msp: false, client: true, description: 'Create client information' },
        { resource: 'client', action: 'update', msp: false, client: true, description: 'Update client information' },
        { resource: 'client', action: 'delete', msp: false, client: true, description: 'Delete client information' },
        
        { resource: 'project', action: 'read', msp: false, client: true, description: 'View projects in client portal' },
        { resource: 'project', action: 'create', msp: false, client: true, description: 'Create projects in client portal' },
        { resource: 'project', action: 'update', msp: false, client: true, description: 'Update projects in client portal' },
        { resource: 'project', action: 'delete', msp: false, client: true, description: 'Delete projects in client portal' },
        
        { resource: 'ticket', action: 'read', msp: false, client: true, description: 'View tickets in client portal' },
        { resource: 'ticket', action: 'create', msp: false, client: true, description: 'Create tickets in client portal' },
        { resource: 'ticket', action: 'update', msp: false, client: true, description: 'Update tickets in client portal' },
        
        { resource: 'time_management', action: 'read', msp: false, client: true, description: 'View time management in client portal' },
        { resource: 'time_management', action: 'create', msp: false, client: true, description: 'Create time entries in client portal' },
        { resource: 'time_management', action: 'update', msp: false, client: true, description: 'Update time entries in client portal' },
        { resource: 'time_management', action: 'delete', msp: false, client: true, description: 'Delete time entries in client portal' },
        
        { resource: 'user', action: 'read', msp: false, client: true, description: 'View users in client portal' },
        { resource: 'user', action: 'create', msp: false, client: true, description: 'Create users in client portal' },
        { resource: 'user', action: 'update', msp: false, client: true, description: 'Update users in client portal' },
        { resource: 'user', action: 'delete', msp: false, client: true, description: 'Delete users in client portal' },
        { resource: 'user', action: 'reset_password', msp: false, client: true, description: 'Reset passwords in client portal' },
        
        { resource: 'document', action: 'read', msp: false, client: true, description: 'View documents in client portal' },
        { resource: 'document', action: 'create', msp: false, client: true, description: 'Create documents in client portal' },
        { resource: 'document', action: 'update', msp: false, client: true, description: 'Update documents in client portal' }
        ,
        // Service Catalog (includes Products as a subset of the catalog)
        { resource: 'service', action: 'create', msp: true, client: false, description: 'Create services/products in the service catalog' },
        { resource: 'service', action: 'read', msp: true, client: false, description: 'View services/products in the service catalog' },
        { resource: 'service', action: 'update', msp: true, client: false, description: 'Update services/products in the service catalog' },
        { resource: 'service', action: 'delete', msp: true, client: false, description: 'Archive/delete services/products in the service catalog' }
    ];

    // Process each tenant
    for (const { tenant } of tenants) {
        // Check which permissions already exist
        const existingPermissions = await knex('permissions').where({ tenant });
        const existingPermMap = new Map();
        existingPermissions.forEach(p => {
            const key = `${p.resource}:${p.action}`;
            existingPermMap.set(key, p);
        });

        // Track inserts and any flag updates we need
        const permissionsToInsert = [];
        const permissionsToUpdate = [];

        for (const perm of allPermissions) {
            const key = `${perm.resource}:${perm.action}`;
            const existing = existingPermMap.get(key);

            if (!existing) {
                permissionsToInsert.push({
                    tenant,
                    resource: perm.resource,
                    action: perm.action,
                    msp: perm.msp,
                    client: perm.client,
                    description: perm.description
                });
            } else {
                const nextMsp = existing.msp || perm.msp;
                const nextClient = existing.client || perm.client;
                const nextDescription = existing.description || perm.description;

                if (nextMsp !== existing.msp || nextClient !== existing.client || (!existing.description && perm.description)) {
                    permissionsToUpdate.push({
                        permission_id: existing.permission_id,
                        msp: nextMsp,
                        client: nextClient,
                        description: nextDescription,
                    });

                    existingPermMap.set(key, {
                        ...existing,
                        msp: nextMsp,
                        client: nextClient,
                        description: nextDescription,
                    });
                }
            }
        }

        if (permissionsToInsert.length > 0) {
            await knex('permissions').insert(permissionsToInsert);
            console.log(`Inserted ${permissionsToInsert.length} new permissions for tenant ${tenant}`);
        } else {
            console.log(`All permissions already exist for tenant ${tenant}`);
        }

        for (const update of permissionsToUpdate) {
            await knex('permissions')
                .where({ permission_id: update.permission_id })
                .update({
                    msp: update.msp,
                    client: update.client,
                    description: update.description,
                    updated_at: knex.fn.now()
                });
        }
    }
};
