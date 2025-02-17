exports.seed = function (knex) {
    return knex('plan_services').del()
        .then(() => {
            return knex('plan_services').insert([
                {
                    tenant: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                    plan_id: knex('billing_plans').where({ tenant: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', plan_name: 'Wonderland Basic' }).select('plan_id').first(),
                    service_id: knex('service_catalog').where({ tenant: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', service_name: 'Rabbit Tracking' }).select('service_id').first(),
                    quantity: 10,
                    custom_rate: null
                },
                {
                    tenant: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                    plan_id: knex('billing_plans').where({ tenant: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', plan_name: 'Wonderland Basic' }).select('plan_id').first(),
                    service_id: knex('service_catalog').where({ tenant: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', service_name: 'Looking Glass Maintenance' }).select('service_id').first(),
                    quantity: 1,
                    custom_rate: null
                },
                {
                    tenant: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                    plan_id: knex('billing_plans').where({ tenant: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', plan_name: 'Oz Premium' }).select('plan_id').first(),
                    service_id: knex('service_catalog').where({ tenant: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', service_name: 'Yellow Brick Road Repair' }).select('service_id').first(),
                    quantity: 20,
                    custom_rate: null
                },
                {
                    tenant: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                    plan_id: knex('billing_plans').where({ tenant: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', plan_name: 'Oz Premium' }).select('plan_id').first(),
                    service_id: knex('service_catalog').where({ tenant: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', service_name: 'Emerald City Security' }).select('service_id').first(),
                    quantity: 1,
                    custom_rate: null
                }]);
        });
};