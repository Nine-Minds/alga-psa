exports.seed = async function (knex, tenantId) {
    // Use provided tenantId or fall back to first tenant
    if (!tenantId) {
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