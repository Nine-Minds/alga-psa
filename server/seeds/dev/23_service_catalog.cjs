const resolveBillingMethod = (typeName, fallbackMethod) => {
    if (typeName === 'Hourly Time') return 'hourly';
    if (typeName === 'Usage Based') return 'usage';
    if (typeName === 'Fixed Price') return 'fixed';
    return fallbackMethod || 'per_unit';
};

exports.seed = async function (knex) { // Changed to async function
    const tenantInfo = await knex('tenants').select('tenant').first();
    if (!tenantInfo) return;
    const tenantId = tenantInfo.tenant;

    // Fetch the relevant service_type_ids for this tenant
    const serviceTypes = await knex('service_types')
        .where({ tenant: tenantId }) // Assuming tenant column is tenant based on ensure_tenant_service_types migration
        .whereIn('name', ['Hourly Time', 'Fixed Price', 'Usage Based']) // Fetch only the types used in this seed
        .select('id', 'name');

    let typeMap = serviceTypes.reduce((map, type) => {
        // Map standard names (like 'Hourly Time') to their tenant-specific UUIDs
        map[type.name] = type.id;
        return map;
    }, {});

    // Check if all needed types were found and log details
    const requiredTypes = ['Hourly Time', 'Fixed Price', 'Usage Based'];
    const foundTypes = Object.keys(typeMap);
    const missingTypes = requiredTypes.filter(rt => !typeMap[rt]);

    // Explicitly check if all required keys are present in the map
    if (!typeMap['Hourly Time'] || !typeMap['Fixed Price'] || !typeMap['Usage Based']) {
        console.warn(`[SEED 23_service_catalog] Tenant ${tenantId} is missing required service types: ${missingTypes.join(', ')}. Attempting to create them...`);

        try {
            // Fetch the standard type IDs and billing_method for the missing types
            const standardTypesToCreate = await knex('standard_service_types')
                .whereIn('name', missingTypes)
                .select('id', 'name', 'billing_method');

            if (standardTypesToCreate.length !== missingTypes.length) {
                const foundStdNames = standardTypesToCreate.map(st => st.name);
                const missingStdNames = missingTypes.filter(mt => !foundStdNames.includes(mt));
                throw new Error(`Could not find standard service type(s) in 'standard_service_types' table: ${missingStdNames.join(', ')}`);
            }

            // Prepare insert data for missing types
            const typesToInsert = standardTypesToCreate.map(stdType => ({
                tenant: tenantId,
                name: stdType.name,
                standard_service_type_id: stdType.id,
                is_active: true,
                billing_method: resolveBillingMethod(stdType.name, stdType.billing_method),
            }));

            // Insert missing types, ignoring conflicts just in case
            if (typesToInsert.length > 0) {
                await knex('service_types')
                    .insert(typesToInsert)
                    .onConflict(['tenant', 'name'])
                    .ignore();
                console.log(`[SEED 23_service_catalog] Attempted to create ${typesToInsert.length} missing service types for tenant ${tenantId}.`);

                // Re-fetch the service types for the tenant
                const updatedServiceTypes = await knex('service_types')
                    .where({ tenant: tenantId })
                    .whereIn('name', requiredTypes)
                    .select('id', 'name', 'billing_method');

                // Re-populate the typeMap
                typeMap = updatedServiceTypes.reduce((map, type) => {
                    map[type.name] = type.id;
                    return map;
                }, {});

                // Final check - if still missing, throw error
                if (!typeMap['Hourly Time'] || !typeMap['Fixed Price'] || !typeMap['Usage Based']) {
                    const stillMissing = requiredTypes.filter(rt => !typeMap[rt]);
                    throw new Error(`Failed to create/find required service types after attempt: ${stillMissing.join(', ')}`);
                }
                console.log(`[SEED 23_service_catalog] Successfully created/verified required service types for tenant ${tenantId}.`);
            }
        } catch (creationError) {
            console.error(`SEED FATAL ERROR in 23_service_catalog.cjs:`);
            console.error(`Tenant ID: ${tenantId}`);
            console.error(`Failed to create missing service types:`, creationError);
            throw creationError; // Halt seeding
        }
    }

    // If the check passes, proceed with insertion
    console.log(`[SEED 23_service_catalog] Found all required service types for tenant ${tenantId}. Proceeding with insert.`);
    return knex('service_catalog').insert([
        {
            tenant: tenantId,
            service_name: 'Rabbit Tracking',
            description: 'Locating and tracking white rabbits',
            custom_service_type_id: typeMap['Hourly Time'], // Use fetched ID
            billing_method: 'hourly',
            default_rate: 7500,
            unit_of_measure: 'Hour',
            category_id: knex('service_categories').where({ tenant: tenantId, category_name: 'Network Services' }).select('category_id').first()
        },
        {
            tenant: tenantId,
            service_name: 'Looking Glass Maintenance',
            description: 'Cleaning and repairing magical mirrors',
            custom_service_type_id: typeMap['Fixed Price'], // Use fetched ID
            billing_method: 'fixed', // Add required billing_method
            default_rate: 15000,
            unit_of_measure: 'Service',
            category_id: knex('service_categories').where({ tenant: tenantId, category_name: 'Security Services' }).select('category_id').first()
        },
        {
            tenant: tenantId,
            service_name: 'Shrinking Potion',
            description: 'Potion to reduce size',
            custom_service_type_id: typeMap['Usage Based'], // Use fetched ID
            billing_method: 'usage',
            default_rate: 2500,
            unit_of_measure: 'Dose',
            category_id: knex('service_categories').where({ tenant: tenantId, category_name: 'Cloud Services' }).select('category_id').first()
        },
        {
            tenant: tenantId,
            service_name: 'Yellow Brick Road Repair',
            description: 'Fixing and maintaining the yellow brick road',
            custom_service_type_id: typeMap['Hourly Time'], // Use fetched ID
            billing_method: 'hourly',
            default_rate: 10000,
            unit_of_measure: 'Hour',
            category_id: knex('service_categories').where({ tenant: tenantId, category_name: 'Network Services' }).select('category_id').first()
        },
        {
            tenant: tenantId,
            service_name: 'Emerald City Security',
            description: '24/7 magical security for Emerald City',
            custom_service_type_id: typeMap['Fixed Price'], // Use fetched ID
            billing_method: 'fixed', // Add required billing_method
            default_rate: 500000,
            unit_of_measure: 'Month',
            category_id: knex('service_categories').where({ tenant: tenantId, category_name: 'Security Services' }).select('category_id').first()
        },
        {
            tenant: tenantId,
            service_name: 'Basic Support',
            description: 'Standard support package',
            custom_service_type_id: typeMap['Hourly Time'], // Use fetched ID
            billing_method: 'hourly',
            default_rate: 10000,
            unit_of_measure: 'Hour',
            category_id: knex('service_categories').where({ tenant: tenantId, category_name: 'Support Services' }).select('category_id').first()
        },
        {
            tenant: tenantId, // Corrected tenant reference
            service_name: 'Premium Support',
            description: 'Premium support package with priority response',
            custom_service_type_id: typeMap['Hourly Time'], // Use fetched ID
            billing_method: 'hourly',
            default_rate: 15000,
            unit_of_measure: 'Hour',
            category_id: knex('service_categories').where({ tenant: tenantId, category_name: 'Support Services' }).select('category_id').first() // Corrected tenant reference in subquery
        }
    ]);
// }); // Removed extra closing from previous .then structure
};
