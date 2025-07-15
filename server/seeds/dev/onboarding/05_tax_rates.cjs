const { v4: uuidv4 } = require('uuid');

exports.seed = async function (knex) {
    // Get the tenant ID from environment or use the first tenant
    let tenantId;
    if (process.env.TENANT_ID) {
        tenantId = process.env.TENANT_ID;
    } else {
        const tenant = await knex('tenants').select('tenant').first();
        if (!tenant) {
            console.log('No tenant found, skipping tax rates seed');
            return;
        }
        tenantId = tenant.tenant;
    }

    // Check if non-taxable rate already exists
    const existingRate = await knex('tax_rates')
        .where({ 
            tenant: tenantId, 
            description: 'Non-taxable',
            tax_percentage: 0 
        })
        .first();

    if (!existingRate) {
        const taxRateId = uuidv4();
        await knex('tax_rates').insert({
            tax_rate_id: taxRateId,
            tenant: tenantId,
            tax_percentage: 0,
            description: 'Non-taxable',
            start_date: knex.fn.now(),
            region_code: 'DEFAULT',
            is_active: true
        });
        console.log(`Created non-taxable rate (0%) for tenant ${tenantId}`);
    } else {
        console.log(`Non-taxable rate already exists for tenant ${tenantId}`);
    }
};