exports.seed = async function (knex) {
    // Get the tenant ID from environment or use the first tenant
    let tenantId;
    if (process.env.TENANT_ID) {
        tenantId = process.env.TENANT_ID;
    } else {
        const tenant = await knex('tenants').select('tenant').first();
        if (!tenant) {
            console.log('No tenant found, skipping tax regions seed');
            return;
        }
        tenantId = tenant.tenant;
    }

    // Check if default tax region already exists
    const existingRegion = await knex('tax_regions')
        .where({ tenant: tenantId, region_code: 'DEFAULT' })
        .first();

    if (!existingRegion) {
        await knex('tax_regions').insert({
            tenant: tenantId,
            region_code: 'DEFAULT',
            region_name: 'Default Tax Region',
            is_active: true
        });
        console.log(`Created default tax region for tenant ${tenantId}`);
    } else {
        console.log(`Default tax region already exists for tenant ${tenantId}`);
    }
};