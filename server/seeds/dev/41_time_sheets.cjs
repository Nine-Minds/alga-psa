const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const glinda = await db.table('users')
        .where({
            username: 'glinda'
        })
        .select('user_id')
        .first();

    const weeklyPeriod = await db.table('time_periods')
        .whereRaw("(end_date - start_date) <= 8")
        .orderBy('start_date', 'desc')
        .select('period_id')
        .first();

    if (!glinda || !weeklyPeriod) return;

    return db.table('time_sheets').insert([
        {
            tenant: tenantId,
            user_id: glinda.user_id,
            period_id: weeklyPeriod.period_id,
            approval_status: 'SUBMITTED',
            submitted_at: knex.raw("CURRENT_TIMESTAMP - INTERVAL '2 days'")
        }
    ]);
};
