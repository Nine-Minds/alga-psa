exports.seed = async function(knex) {
    // First clear any existing client locations
    await knex('client_locations').del();

    // Get tenant and clients
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    const clients = await knex('clients')
        .where('tenant', tenant.tenant)
        .select('client_id', 'client_name');

    // Create locations for each client based on their existing address
    const clientLocations = [];
    
    for (const client of clients) {
        if (client.client_name === 'Emerald City') {
            clientLocations.push({
                location_id: knex.raw('gen_random_uuid()'),
                tenant: tenant.tenant,
                client_id: client.client_id,
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
            clientLocations.push({
                location_id: knex.raw('gen_random_uuid()'),
                tenant: tenant.tenant,
                client_id: client.client_id,
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
        } else if (client.client_name === 'Wonderland') {
            clientLocations.push({
                location_id: knex.raw('gen_random_uuid()'),
                tenant: tenant.tenant,
                client_id: client.client_id,
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
        } else if (client.client_name === 'White Rabbit') {
            clientLocations.push({
                location_id: knex.raw('gen_random_uuid()'),
                tenant: tenant.tenant,
                client_id: client.client_id,
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

    if (clientLocations.length > 0) {
        await knex('client_locations').insert(clientLocations);
    }
};