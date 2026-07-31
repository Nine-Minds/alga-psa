const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { db, tenantId } = context;

    // Get contract lines
    const wonderlandBasic = await db.table('contract_lines')
        .where({ contract_line_name: 'Wonderland Basic' })
        .select('contract_line_id')
        .first();

    const ozPremium = await db.table('contract_lines')
        .where({ contract_line_name: 'Oz Premium' })
        .select('contract_line_id')
        .first();

    // Get services
    const rabbitTracking = await db.table('service_catalog')
        .where({ service_name: 'Rabbit Tracking' })
        .select('service_id')
        .first();

    const lookingGlass = await db.table('service_catalog')
        .where({ service_name: 'Looking Glass Maintenance' })
        .select('service_id')
        .first();

    const yellowBrick = await db.table('service_catalog')
        .where({ service_name: 'Yellow Brick Road Repair' })
        .select('service_id')
        .first();

    const emeraldSecurity = await db.table('service_catalog')
        .where({ service_name: 'Emerald City Security' })
        .select('service_id')
        .first();

    const recordsToInsert = [];

    if (wonderlandBasic && rabbitTracking) {
        recordsToInsert.push({
            tenant: tenantId,
            contract_line_id: wonderlandBasic.contract_line_id,
            service_id: rabbitTracking.service_id,
            quantity: 10,
            custom_rate: null
        });
    }

    if (wonderlandBasic && lookingGlass) {
        recordsToInsert.push({
            tenant: tenantId,
            contract_line_id: wonderlandBasic.contract_line_id,
            service_id: lookingGlass.service_id,
            quantity: 1,
            custom_rate: null
        });
    }

    if (ozPremium && yellowBrick) {
        recordsToInsert.push({
            tenant: tenantId,
            contract_line_id: ozPremium.contract_line_id,
            service_id: yellowBrick.service_id,
            quantity: 20,
            custom_rate: null
        });
    }

    if (ozPremium && emeraldSecurity) {
        recordsToInsert.push({
            tenant: tenantId,
            contract_line_id: ozPremium.contract_line_id,
            service_id: emeraldSecurity.service_id,
            quantity: 1,
            custom_rate: null
        });
    }

    if (recordsToInsert.length > 0) {
        await db.table('contract_line_services').insert(recordsToInsert);
    }
};
