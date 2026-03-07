exports.seed = async function (knex) {
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    const glinda = await knex('users')
        .where({
            tenant: tenant.tenant,
            username: 'glinda'
        })
        .select('user_id')
        .first();

    const weeklyPeriod = await knex('time_periods')
        .where({ tenant: tenant.tenant })
        .whereRaw("(end_date - start_date) <= 8")
        .orderBy('start_date', 'desc')
        .select('period_id')
        .first();

    if (!glinda || !weeklyPeriod) return;

    return knex('time_sheets').insert([
        {
            tenant: tenant.tenant,
            user_id: glinda.user_id,
            period_id: weeklyPeriod.period_id,
            approval_status: 'SUBMITTED',
            submitted_at: knex.raw("CURRENT_TIMESTAMP - INTERVAL '2 days'")
        }
    ]);
};
