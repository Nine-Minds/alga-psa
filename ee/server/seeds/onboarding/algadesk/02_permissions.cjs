exports.seed = async function(knex, tenantId) {
    const { tenantDb } = await import('@alga-psa/db');

    let tenants;
    if (tenantId) {
        tenants = [{ tenant: tenantId }];
    } else {
        tenants = await knex('tenants').where({ product_code: 'algadesk' }).select('tenant');
        if (!tenants.length) {
            console.log('No Algadesk tenants found, skipping permissions seed');
            return;
        }
    }

    const mspPermissions = [
        ['account_management', ['read', 'update', 'delete'], 'account and subscription'],
        ['client', ['create', 'read', 'update', 'delete'], 'clients'],
        ['contact', ['create', 'read', 'update', 'delete'], 'contacts'],
        ['document', ['create', 'read', 'update', 'delete'], 'documents'],
        ['profile', ['read', 'update'], 'profiles'],
        ['reports', ['create', 'read', 'update', 'delete'], 'reports'],
        ['settings', ['read', 'update'], 'settings'],
        ['system_settings', ['read', 'update'], 'system settings'],
        ['security_settings', ['read', 'update'], 'security settings'],
        ['tag', ['create', 'read', 'update', 'delete'], 'tags'],
        ['ticket', ['create', 'read', 'update', 'delete'], 'tickets'],
        ['ticket_settings', ['create', 'read', 'update', 'delete'], 'ticket settings'],
        ['user', ['create', 'read', 'update', 'delete', 'invite', 'reset_password'], 'users'],
        ['user_settings', ['create', 'read', 'update', 'delete'], 'user and team settings']
    ];

    const clientPermissions = [
        ['client', ['read', 'update'], 'client information'],
        ['contact', ['read', 'update'], 'contacts'],
        ['document', ['create', 'read', 'update'], 'documents'],
        ['settings', ['read', 'update'], 'portal settings'],
        ['ticket', ['create', 'read', 'update', 'delete'], 'tickets'],
        ['user', ['create', 'read', 'update', 'delete', 'reset_password'], 'client portal users']
    ];

    const allPermissions = [
        ...mspPermissions.flatMap(([resource, actions, label]) =>
            actions.map(action => ({
                resource,
                action,
                msp: true,
                client: false,
                description: `${action.charAt(0).toUpperCase()}${action.slice(1).replace('_', ' ')} ${label}`
            }))
        ),
        ...clientPermissions.flatMap(([resource, actions, label]) =>
            actions.map(action => ({
                resource,
                action,
                msp: false,
                client: true,
                description: `${action.charAt(0).toUpperCase()}${action.slice(1).replace('_', ' ')} ${label}`
            }))
        )
    ];

    for (const { tenant } of tenants) {
        const db = tenantDb(knex, tenant);
        const existingPermissions = await db.table('permissions');
        const existingPermMap = new Map();
        existingPermissions.forEach(p => {
            const key = `${p.resource}:${p.action}:${p.msp ? 'msp' : 'client'}`;
            existingPermMap.set(key, p);
        });

        const permissionsToInsert = [];
        for (const perm of allPermissions) {
            const key = `${perm.resource}:${perm.action}:${perm.msp ? 'msp' : 'client'}`;
            if (!existingPermMap.has(key)) {
                permissionsToInsert.push({ tenant, ...perm });
            }
        }

        if (permissionsToInsert.length > 0) {
            await db.table('permissions').insert(permissionsToInsert);
            console.log(`Inserted ${permissionsToInsert.length} Algadesk permissions for tenant ${tenant}`);
        } else {
            console.log(`All Algadesk permissions already exist for tenant ${tenant}`);
        }
    }
};
