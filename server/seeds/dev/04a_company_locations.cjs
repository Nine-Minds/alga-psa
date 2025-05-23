exports.seed = async function(knex) {
    // First clear any existing company locations
    await knex('company_locations').del();

    // Get tenant and companies
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    const companies = await knex('companies')
        .where('tenant', tenant.tenant)
        .select('company_id', 'company_name', 'address');

    // Create locations for each company based on their existing address
    const companyLocations = [];
    
    for (const company of companies) {
        if (company.company_name === 'Emerald City') {
            companyLocations.push({
                location_id: knex.raw('gen_random_uuid()'),
                tenant: tenant.tenant,
                company_id: company.company_id,
                location_name: 'Main Office',
                address_line1: '1010 Emerald Street',
                address_line2: 'Suite 007',
                city: 'Emerald City',
                state_province: 'OZ',
                postal_code: '77777',
                country_code: 'US',
                country_name: 'United States',
                region_code: null,
                is_billing_address: true,
                is_shipping_address: true,
                is_default: true,
                phone: '555-123-4567',
                email: 'info@emeraldcity.oz',
                is_active: true,
                created_at: knex.fn.now(),
                updated_at: knex.fn.now()
            });
            
            // Add a second location for Emerald City
            companyLocations.push({
                location_id: knex.raw('gen_random_uuid()'),
                tenant: tenant.tenant,
                company_id: company.company_id,
                location_name: 'Warehouse',
                address_line1: '2020 Yellow Brick Road',
                city: 'Emerald City',
                state_province: 'OZ',
                postal_code: '77778',
                country_code: 'US',
                country_name: 'United States',
                region_code: null,
                is_billing_address: false,
                is_shipping_address: true,
                is_default: false,
                phone: '555-123-4568',
                is_active: true,
                created_at: knex.fn.now(),
                updated_at: knex.fn.now()
            });
        } else if (company.company_name === 'Wonderland') {
            companyLocations.push({
                location_id: knex.raw('gen_random_uuid()'),
                tenant: tenant.tenant,
                company_id: company.company_id,
                location_name: 'Headquarters',
                address_line1: '42 Rabbit Hole Lane',
                address_line2: 'Underland Woods',
                city: 'Wonderland',
                state_province: 'WND',
                postal_code: '1234',
                country_code: 'UK',
                country_name: 'United Kingdom',
                region_code: null,
                is_billing_address: true,
                is_shipping_address: true,
                is_default: true,
                phone: '555-789-0123',
                email: 'contact@wonderland.com',
                notes: 'Mind the Cheshire Cat',
                is_active: true,
                created_at: knex.fn.now(),
                updated_at: knex.fn.now()
            });
        } else if (company.company_name === 'White Rabbit') {
            companyLocations.push({
                location_id: knex.raw('gen_random_uuid()'),
                tenant: tenant.tenant,
                company_id: company.company_id,
                location_name: 'Rabbit Hole',
                address_line1: '42 Rabbit Hole Lane',
                address_line2: 'Underland Woods',
                city: 'Wonderland',
                state_province: 'WND',
                postal_code: '1234',
                country_code: 'UK',
                country_name: 'United Kingdom',
                region_code: null,
                is_billing_address: true,
                is_shipping_address: false,
                is_default: true,
                phone: '555-TIME-123',
                notes: 'Always late!',
                is_active: true,
                created_at: knex.fn.now(),
                updated_at: knex.fn.now()
            });
        }
    }

    if (companyLocations.length > 0) {
        await knex('company_locations').insert(companyLocations);
    }
};