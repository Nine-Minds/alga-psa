exports.seed = async function(knex) {
    // Get all tenants
    const tenants = await knex('tenants').select('tenant');
    if (!tenants.length) return;

    // Define all comprehensive permissions needed based on security audit
    const allPermissions = [
        // Asset permissions
        { resource: 'asset', action: 'create', msp: true, client: false },
        { resource: 'asset', action: 'read', msp: true, client: true },
        { resource: 'asset', action: 'update', msp: true, client: false },
        { resource: 'asset', action: 'delete', msp: true, client: false },
        
        // Billing permissions
        { resource: 'billing', action: 'create', msp: true, client: false },
        { resource: 'billing', action: 'read', msp: true, client: true },
        { resource: 'billing', action: 'update', msp: true, client: false },
        { resource: 'billing', action: 'delete', msp: true, client: false },
        { resource: 'billing', action: 'reconcile', msp: true, client: false },
        
        // Client permissions
        { resource: 'client', action: 'create', msp: true, client: false },
        { resource: 'client', action: 'read', msp: true, client: true },
        { resource: 'client', action: 'update', msp: true, client: false },
        { resource: 'client', action: 'delete', msp: true, client: false },
        
        // Company permissions
        { resource: 'company', action: 'create', msp: true, client: false },
        { resource: 'company', action: 'read', msp: true, client: true },
        { resource: 'company', action: 'update', msp: true, client: false },
        { resource: 'company', action: 'delete', msp: true, client: false },
        
        // Contact permissions
        { resource: 'contact', action: 'create', msp: true, client: true },
        { resource: 'contact', action: 'read', msp: true, client: true },
        { resource: 'contact', action: 'update', msp: true, client: true },
        { resource: 'contact', action: 'delete', msp: true, client: false },
        
        // Credit permissions
        { resource: 'credit', action: 'create', msp: true, client: false },
        { resource: 'credit', action: 'read', msp: true, client: true },
        { resource: 'credit', action: 'update', msp: true, client: false },
        { resource: 'credit', action: 'delete', msp: true, client: false },
        { resource: 'credit', action: 'transfer', msp: true, client: false },
        { resource: 'credit', action: 'apply', msp: true, client: false },
        { resource: 'credit', action: 'reconcile', msp: true, client: false },
        
        // Document permissions
        { resource: 'document', action: 'create', msp: true, client: true },
        { resource: 'document', action: 'read', msp: true, client: true },
        { resource: 'document', action: 'update', msp: true, client: true },
        { resource: 'document', action: 'delete', msp: true, client: false },
        
        // Invoice permissions
        { resource: 'invoice', action: 'create', msp: true, client: false },
        { resource: 'invoice', action: 'read', msp: true, client: true },
        { resource: 'invoice', action: 'update', msp: true, client: false },
        { resource: 'invoice', action: 'delete', msp: true, client: false },
        { resource: 'invoice', action: 'generate', msp: true, client: false },
        { resource: 'invoice', action: 'finalize', msp: true, client: false },
        { resource: 'invoice', action: 'send', msp: true, client: false },
        { resource: 'invoice', action: 'void', msp: true, client: false },
        
        // Profile permissions
        { resource: 'profile', action: 'create', msp: true, client: false },
        { resource: 'profile', action: 'read', msp: true, client: true },
        { resource: 'profile', action: 'update', msp: true, client: true },
        { resource: 'profile', action: 'delete', msp: true, client: false },
        
        // Project permissions
        { resource: 'project', action: 'create', msp: true, client: false },
        { resource: 'project', action: 'read', msp: true, client: true },
        { resource: 'project', action: 'update', msp: true, client: false },
        { resource: 'project', action: 'delete', msp: true, client: false },
        
        // Tag permissions
        { resource: 'tag', action: 'create', msp: true, client: false },
        { resource: 'tag', action: 'read', msp: true, client: true },
        { resource: 'tag', action: 'update', msp: true, client: false },
        { resource: 'tag', action: 'delete', msp: true, client: false },
        
        // Tax permissions
        { resource: 'tax', action: 'create', msp: true, client: false },
        { resource: 'tax', action: 'read', msp: true, client: false },
        { resource: 'tax', action: 'update', msp: true, client: false },
        { resource: 'tax', action: 'delete', msp: true, client: false },
        { resource: 'tax', action: 'calculate', msp: true, client: false },
        
        // Team permissions
        { resource: 'team', action: 'create', msp: true, client: false },
        { resource: 'team', action: 'read', msp: true, client: false },
        { resource: 'team', action: 'update', msp: true, client: false },
        { resource: 'team', action: 'delete', msp: true, client: false },
        { resource: 'team', action: 'manage', msp: true, client: false },
        
        // Technician dispatch permissions
        { resource: 'technician_dispatch', action: 'create', msp: true, client: false },
        { resource: 'technician_dispatch', action: 'read', msp: true, client: false },
        { resource: 'technician_dispatch', action: 'update', msp: true, client: false },
        { resource: 'technician_dispatch', action: 'delete', msp: true, client: false },
        
        // Ticket permissions
        { resource: 'ticket', action: 'create', msp: true, client: true },
        { resource: 'ticket', action: 'read', msp: true, client: true },
        { resource: 'ticket', action: 'update', msp: true, client: true },
        { resource: 'ticket', action: 'delete', msp: true, client: false },
        
        // Time entry permissions
        { resource: 'timeentry', action: 'create', msp: true, client: false },
        { resource: 'timeentry', action: 'read', msp: true, client: false },
        { resource: 'timeentry', action: 'update', msp: true, client: false },
        { resource: 'timeentry', action: 'delete', msp: true, client: false },
        
        // Time period permissions
        { resource: 'timeperiod', action: 'create', msp: true, client: false },
        { resource: 'timeperiod', action: 'read', msp: true, client: false },
        { resource: 'timeperiod', action: 'update', msp: true, client: false },
        { resource: 'timeperiod', action: 'delete', msp: true, client: false },
        { resource: 'timeperiod', action: 'manage', msp: true, client: false },
        
        // Timesheet permissions
        { resource: 'timesheet', action: 'create', msp: true, client: false },
        { resource: 'timesheet', action: 'read', msp: true, client: false },
        { resource: 'timesheet', action: 'update', msp: true, client: false },
        { resource: 'timesheet', action: 'delete', msp: true, client: false },
        { resource: 'timesheet', action: 'submit', msp: true, client: false },
        { resource: 'timesheet', action: 'approve', msp: true, client: false },
        { resource: 'timesheet', action: 'reverse', msp: true, client: false },
        
        // User permissions - MSP can manage all users
        { resource: 'user', action: 'create', msp: true, client: false },
        { resource: 'user', action: 'read', msp: true, client: false },
        { resource: 'user', action: 'update', msp: true, client: false },
        { resource: 'user', action: 'delete', msp: true, client: false },
        
        // User permissions for client portal - Client admins can manage their own users
        { resource: 'user', action: 'create', msp: false, client: true },
        { resource: 'user', action: 'read', msp: false, client: true },
        { resource: 'user', action: 'update', msp: false, client: true },
        { resource: 'user', action: 'delete', msp: false, client: true },
        { resource: 'user', action: 'invite', msp: false, client: true },
        { resource: 'user', action: 'reset_password', msp: false, client: true },
        
        // User schedule permissions
        { resource: 'user_schedule', action: 'create', msp: true, client: false },
        { resource: 'user_schedule', action: 'read', msp: true, client: false },
        { resource: 'user_schedule', action: 'update', msp: true, client: false },
        { resource: 'user_schedule', action: 'delete', msp: true, client: false },
        
        // Workflow permissions
        { resource: 'workflow', action: 'create', msp: true, client: false },
        { resource: 'workflow', action: 'read', msp: true, client: false },
        { resource: 'workflow', action: 'update', msp: true, client: false },
        { resource: 'workflow', action: 'delete', msp: true, client: false },
        { resource: 'workflow', action: 'execute', msp: true, client: false },
        
        // Service permissions
        { resource: 'service', action: 'create', msp: true, client: false },
        { resource: 'service', action: 'read', msp: true, client: false },
        { resource: 'service', action: 'update', msp: true, client: false },
        { resource: 'service', action: 'delete', msp: true, client: false },
        
        // Comment permissions
        { resource: 'comment', action: 'create', msp: true, client: true },
        { resource: 'comment', action: 'read', msp: true, client: true },
        { resource: 'comment', action: 'update', msp: true, client: true },
        { resource: 'comment', action: 'delete', msp: true, client: false },
        
        // Interaction permissions
        { resource: 'interaction', action: 'create', msp: true, client: false },
        { resource: 'interaction', action: 'read', msp: true, client: false },
        { resource: 'interaction', action: 'update', msp: true, client: false },
        { resource: 'interaction', action: 'delete', msp: true, client: false },
        
        // Priority permissions
        { resource: 'priority', action: 'create', msp: true, client: false },
        { resource: 'priority', action: 'read', msp: true, client: true },
        { resource: 'priority', action: 'update', msp: true, client: false },
        { resource: 'priority', action: 'delete', msp: true, client: false },
        
        // Category permissions
        { resource: 'category', action: 'create', msp: true, client: false },
        { resource: 'category', action: 'read', msp: true, client: true },
        { resource: 'category', action: 'update', msp: true, client: false },
        { resource: 'category', action: 'delete', msp: true, client: false },
        
        // Notification permissions
        { resource: 'notification', action: 'create', msp: true, client: false },
        { resource: 'notification', action: 'read', msp: true, client: true },
        { resource: 'notification', action: 'update', msp: true, client: true },
        { resource: 'notification', action: 'delete', msp: true, client: true },
        
        // Template permissions
        { resource: 'template', action: 'create', msp: true, client: false },
        { resource: 'template', action: 'read', msp: true, client: false },
        { resource: 'template', action: 'update', msp: true, client: false },
        { resource: 'template', action: 'delete', msp: true, client: false },
        
        // Email permissions
        { resource: 'email', action: 'create', msp: true, client: false },
        { resource: 'email', action: 'read', msp: true, client: false },
        { resource: 'email', action: 'update', msp: true, client: false },
        { resource: 'email', action: 'delete', msp: true, client: false },
        
        // Settings permissions
        { resource: 'ticket_settings', action: 'read', msp: true, client: false },
        { resource: 'ticket_settings', action: 'update', msp: true, client: false },
        { resource: 'user_settings', action: 'read', msp: true, client: false },
        { resource: 'user_settings', action: 'update', msp: true, client: false },
        { resource: 'user_settings', action: 'read', msp: false, client: true },
        { resource: 'user_settings', action: 'update', msp: false, client: true },
        { resource: 'system_settings', action: 'read', msp: true, client: false },
        { resource: 'system_settings', action: 'update', msp: true, client: false },
        { resource: 'security_settings', action: 'read', msp: true, client: false },
        { resource: 'security_settings', action: 'update', msp: true, client: false },
        { resource: 'timeentry_settings', action: 'read', msp: true, client: false },
        { resource: 'timeentry_settings', action: 'update', msp: true, client: false },
        { resource: 'billing_settings', action: 'create', msp: true, client: false },
        { resource: 'billing_settings', action: 'read', msp: true, client: false },
        { resource: 'billing_settings', action: 'update', msp: true, client: false },
        { resource: 'billing_settings', action: 'delete', msp: true, client: false },
        
        // Registration permissions
        { resource: 'registration', action: 'approve', msp: true, client: false }
    ];

    // Don't clear existing permissions - only add missing ones
    // This prevents losing custom permissions added after initial setup

    // Process each tenant
    for (const { tenant } of tenants) {
        // Check which permissions already exist
        const existingPermissions = await knex('permissions').where({ tenant });
        const existingPermMap = new Map();
        existingPermissions.forEach(p => {
            existingPermMap.set(`${p.resource}:${p.action}`, p);
        });

        // Only insert permissions that don't exist
        const permissionsToInsert = [];
        for (const perm of allPermissions) {
            const key = `${perm.resource}:${perm.action}`;
            if (!existingPermMap.has(key)) {
                permissionsToInsert.push({
                    tenant,
                    resource: perm.resource,
                    action: perm.action,
                    msp: perm.msp,
                    client: perm.client
                });
            }
        }

        if (permissionsToInsert.length > 0) {
            await knex('permissions').insert(permissionsToInsert);
            console.log(`Inserted ${permissionsToInsert.length} new permissions for tenant ${tenant}`);
        }

        // Get all permissions for this tenant
        const permissions = await knex('permissions').where({ tenant });

        // Get Admin role for this tenant (MSP Admin)
        const adminRole = await knex('roles')
            .where({ tenant, role_name: 'Admin', msp: true, client: false })
            .first();

        if (adminRole) {
            // Clear existing permissions for Admin role
            await knex('role_permissions')
                .where({ tenant, role_id: adminRole.role_id })
                .del();

            // Assign all MSP permissions to Admin role
            const adminPermissions = permissions
                .filter(p => p.msp)
                .map(permission => ({
                    tenant,
                    role_id: adminRole.role_id,
                    permission_id: permission.permission_id
                }));

            if (adminPermissions.length > 0) {
                await knex('role_permissions').insert(adminPermissions);
            }
        }

        // Get Manager role for this tenant
        const managerRole = await knex('roles')
            .where({ tenant, role_name: 'Manager', msp: true, client: false })
            .first();

        if (managerRole) {
            // Clear existing permissions for Manager role
            await knex('role_permissions')
                .where({ tenant, role_id: managerRole.role_id })
                .del();

            // Define manager-specific permissions
            const managerResourceActions = [
                // Full ticket management
                { resource: 'ticket', action: 'create' },
                { resource: 'ticket', action: 'read' },
                { resource: 'ticket', action: 'update' },
                { resource: 'ticket', action: 'delete' },
                // User management (no delete)
                { resource: 'user', action: 'create' },
                { resource: 'user', action: 'read' },
                { resource: 'user', action: 'update' },
                // Project management
                { resource: 'project', action: 'create' },
                { resource: 'project', action: 'read' },
                { resource: 'project', action: 'update' },
                { resource: 'project', action: 'delete' },
                // Read-only for companies
                { resource: 'company', action: 'read' },
                // Team management
                { resource: 'team', action: 'create' },
                { resource: 'team', action: 'read' },
                { resource: 'team', action: 'update' },
                { resource: 'team', action: 'manage' },
                // Time tracking oversight
                { resource: 'timeentry', action: 'read' },
                { resource: 'timeentry', action: 'update' },
                { resource: 'timesheet', action: 'read' },
                { resource: 'timesheet', action: 'approve' },
                // Contact management
                { resource: 'contact', action: 'create' },
                { resource: 'contact', action: 'read' },
                { resource: 'contact', action: 'update' },
                // Document management
                { resource: 'document', action: 'create' },
                { resource: 'document', action: 'read' },
                { resource: 'document', action: 'update' },
                // Read access to assets
                { resource: 'asset', action: 'read' },
                // Category and priority management
                { resource: 'category', action: 'read' },
                { resource: 'priority', action: 'read' },
                // Notification management
                { resource: 'notification', action: 'create' },
                { resource: 'notification', action: 'read' },
                { resource: 'notification', action: 'update' },
                // Comment management
                { resource: 'comment', action: 'create' },
                { resource: 'comment', action: 'read' },
                { resource: 'comment', action: 'update' },
                // Service read access
                { resource: 'service', action: 'read' },
                // Tag management
                { resource: 'tag', action: 'create' },
                { resource: 'tag', action: 'read' },
                { resource: 'tag', action: 'update' },
                // Schedule management
                { resource: 'user_schedule', action: 'read' },
                { resource: 'user_schedule', action: 'update' },
                // Registration approval
                { resource: 'registration', action: 'approve' }
            ];

            // Find and assign manager permissions
            const managerPermissions = [];
            for (const ra of managerResourceActions) {
                const permission = permissions.find(p => 
                    p.resource === ra.resource && 
                    p.action === ra.action &&
                    p.msp === true
                );
                if (permission) {
                    managerPermissions.push({
                        tenant,
                        role_id: managerRole.role_id,
                        permission_id: permission.permission_id
                    });
                }
            }

            if (managerPermissions.length > 0) {
                await knex('role_permissions').insert(managerPermissions);
            }
        }
    }
};