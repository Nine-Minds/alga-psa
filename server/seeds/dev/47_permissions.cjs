exports.seed = async function(knex) {
    // Get all tenants
    const tenants = await knex('tenants').select('tenant');
    if (!tenants.length) return;

    // Define all comprehensive permissions needed based on security audit
    const allPermissions = [
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
        { resource: 'credit', action: 'reconcile', msp: true, client: false, description: 'Reconcile credit transactions' },
        
        // Document permissions
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
        { resource: 'invoice', action: 'void', msp: true, client: false, description: 'Void finalized invoices' },
        
        // Profile permissions - MSP only
        { resource: 'profile', action: 'create', msp: true, client: false, description: 'Create user profiles' },
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
        { resource: 'tag', action: 'update', msp: true, client: false, description: 'Edit tag names and colors' },
        { resource: 'tag', action: 'delete', msp: true, client: false, description: 'Remove tags from the system' },
        
        // Tax permissions
        { resource: 'tax', action: 'create', msp: true, client: false, description: 'Create tax rates and rules' },
        { resource: 'tax', action: 'read', msp: true, client: false, description: 'View tax configurations' },
        { resource: 'tax', action: 'update', msp: true, client: false, description: 'Modify tax rates and rules' },
        { resource: 'tax', action: 'delete', msp: true, client: false, description: 'Remove tax configurations' },
        { resource: 'tax', action: 'calculate', msp: true, client: false, description: 'Calculate tax amounts' },
        
        // Team permissions
        { resource: 'team', action: 'create', msp: true, client: false, description: 'Create new teams' },
        { resource: 'team', action: 'read', msp: true, client: false, description: 'View team information' },
        { resource: 'team', action: 'update', msp: true, client: false, description: 'Edit team details and members' },
        { resource: 'team', action: 'delete', msp: true, client: false, description: 'Delete teams' },
        { resource: 'team', action: 'manage', msp: true, client: false, description: 'Manage team membership and roles' },
        
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
        
        // Time period permissions
        { resource: 'timeperiod', action: 'create', msp: true, client: false, description: 'Create billing and work periods' },
        { resource: 'timeperiod', action: 'read', msp: true, client: false, description: 'View time period configurations' },
        { resource: 'timeperiod', action: 'update', msp: true, client: false, description: 'Modify time period settings' },
        { resource: 'timeperiod', action: 'delete', msp: true, client: false, description: 'Remove time periods' },
        { resource: 'timeperiod', action: 'manage', msp: true, client: false, description: 'Manage time period assignments' },
        
        // Timesheet permissions
        { resource: 'timesheet', action: 'create', msp: true, client: false, description: 'Create timesheets for time tracking' },
        { resource: 'timesheet', action: 'read', msp: true, client: false, description: 'View timesheet summaries and details' },
        { resource: 'timesheet', action: 'update', msp: true, client: false, description: 'Modify timesheet entries' },
        { resource: 'timesheet', action: 'delete', msp: true, client: false, description: 'Delete timesheets' },
        { resource: 'timesheet', action: 'submit', msp: true, client: false, description: 'Submit timesheets for approval' },
        { resource: 'timesheet', action: 'approve', msp: true, client: false, description: 'Approve or reject submitted timesheets' },
        { resource: 'timesheet', action: 'reverse', msp: true, client: false, description: 'Reverse timesheet approvals' },
        
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
        
        // Workflow permissions
        { resource: 'workflow', action: 'create', msp: true, client: false, description: 'Create workflow automations' },
        { resource: 'workflow', action: 'read', msp: true, client: false, description: 'View workflow configurations' },
        { resource: 'workflow', action: 'update', msp: true, client: false, description: 'Modify workflow rules and actions' },
        { resource: 'workflow', action: 'delete', msp: true, client: false, description: 'Remove workflow automations' },
        { resource: 'workflow', action: 'execute', msp: true, client: false, description: 'Manually trigger workflows' },
        
        // Service permissions
        { resource: 'service', action: 'create', msp: true, client: false, description: 'Create service catalog items' },
        { resource: 'service', action: 'read', msp: true, client: false, description: 'View service catalog' },
        { resource: 'service', action: 'update', msp: true, client: false, description: 'Modify service offerings' },
        { resource: 'service', action: 'delete', msp: true, client: false, description: 'Remove service catalog items' },
        
        // Interaction permissions
        { resource: 'interaction', action: 'create', msp: true, client: false, description: 'Log customer interactions' },
        { resource: 'interaction', action: 'read', msp: true, client: false, description: 'View interaction history' },
        { resource: 'interaction', action: 'update', msp: true, client: false, description: 'Edit interaction details' },
        { resource: 'interaction', action: 'delete', msp: true, client: false, description: 'Remove interaction records' },
        
        // Priority permissions - MSP only
        { resource: 'priority', action: 'create', msp: true, client: false, description: 'Create priority levels' },
        { resource: 'priority', action: 'read', msp: true, client: false, description: 'View priority configurations' },
        { resource: 'priority', action: 'update', msp: true, client: false, description: 'Modify priority settings' },
        { resource: 'priority', action: 'delete', msp: true, client: false, description: 'Remove priority levels' },
        
        // Notification permissions - MSP only
        { resource: 'notification', action: 'create', msp: true, client: false, description: 'Create system notifications' },
        { resource: 'notification', action: 'read', msp: true, client: false, description: 'View notifications' },
        { resource: 'notification', action: 'update', msp: true, client: false, description: 'Mark notifications as read' },
        { resource: 'notification', action: 'delete', msp: true, client: false, description: 'Delete notifications' },
        
        // Template permissions
        { resource: 'template', action: 'create', msp: true, client: false, description: 'Create document and email templates' },
        { resource: 'template', action: 'read', msp: true, client: false, description: 'View available templates' },
        { resource: 'template', action: 'update', msp: true, client: false, description: 'Edit template content' },
        { resource: 'template', action: 'delete', msp: true, client: false, description: 'Remove templates' },
        
        // Email permissions
        { resource: 'email', action: 'create', msp: true, client: false, description: 'Compose and send emails' },
        { resource: 'email', action: 'read', msp: true, client: false, description: 'View email history' },
        { resource: 'email', action: 'update', msp: true, client: false, description: 'Edit draft emails' },
        { resource: 'email', action: 'delete', msp: true, client: false, description: 'Delete email records' },
        
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
        
        // Registration permissions
        { resource: 'registration', action: 'approve', msp: true, client: false, description: 'Approve new user registrations' }
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
                    client: perm.client,
                    description: perm.description
                });
            } else {
                // Update existing permission with description if it doesn't have one
                const existing = existingPermMap.get(key);
                if (!existing.description && perm.description) {
                    await knex('permissions')
                        .where({ tenant, permission_id: existing.permission_id })
                        .update({ description: perm.description });
                }
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
                // Priority management
                { resource: 'priority', action: 'read' },
                // Notification management
                { resource: 'notification', action: 'create' },
                { resource: 'notification', action: 'read' },
                { resource: 'notification', action: 'update' },
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