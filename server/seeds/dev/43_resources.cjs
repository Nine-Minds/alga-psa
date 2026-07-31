exports.seed = async function (knex) {
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    const user = await knex('users')
        .where({ tenant: tenant.tenant, username: 'glinda' })
        .select('user_id')
        .first();
    if (!user) return;

    await knex('resources').insert([
        {
            tenant: tenant.tenant,
            user_id: user.user_id,
            skills: ['magic', 'project management', 'customer service'],
            max_daily_capacity: 8,
            max_weekly_capacity: 40
        }
    ]);

    // Mon-Fri 09:00-17:00. The weekend rows still carry a valid window because
    // the table's CHECK requires end_time > start_time; is_working is what makes
    // them contribute no capacity. Seeding these exercises the report's
    // 'schedule' capacity source rather than the weekly fallback.
    await knex('user_work_schedules').insert(
        [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
            tenant: tenant.tenant,
            user_id: user.user_id,
            day_of_week: dayOfWeek,
            start_time: '09:00',
            end_time: '17:00',
            is_working: dayOfWeek >= 1 && dayOfWeek <= 5
        }))
    );
};
