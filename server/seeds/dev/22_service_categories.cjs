exports.seed = async function (knex) { // Changed to async
    // Fetch the first tenant ID
    const tenantInfo = await knex('tenants').select('tenant').first();
    if (!tenantInfo) {
        console.log('No tenant found, skipping service_categories seed.');
        return;
    }
    const tenantId = tenantInfo.tenant;

    // Delete existing categories for this tenant (or all if desired, be careful)
    // Consider if deleting all is appropriate or just for the specific tenant
    await knex('service_categories').where({ tenant: tenantId }).del(); // Changed to delete only for the fetched tenant

    // Insert new categories using the fetched tenant ID
    return knex('service_categories').insert([
        { tenant: tenantId, category_name: 'Network Services', description: 'Services related to network infrastructure', display_order: 1 },
        { tenant: tenantId, category_name: 'Security Services', description: 'Services focused on cybersecurity', display_order: 2 },
        { tenant: tenantId, category_name: 'Cloud Services', description: 'Cloud-based solutions and management', display_order: 3 },
        // Add the missing 'Support Services' category needed by 23_service_catalog.cjs
        { tenant: tenantId, category_name: 'Support Services', description: 'Customer support and helpdesk services', display_order: 4 }
    ]);
};