exports.seed = function (knex) {
    return knex('service_catalog').del()
        .then(() => {
            return knex('service_catalog').insert([
                {
                    tenant: '11111111-1111-1111-1111-111111111111',
                    service_name: 'Rabbit Tracking',
                    description: 'Locating and tracking white rabbits',
                    service_type: 'Time',
                    default_rate: 75.00,
                    unit_of_measure: 'Hour',
                    category_id: knex('service_categories').where({ tenant: '11111111-1111-1111-1111-111111111111', category_name: 'Network Services' }).select('category_id').first()
                },
                {
                    tenant: '11111111-1111-1111-1111-111111111111',
                    service_name: 'Looking Glass Maintenance',
                    description: 'Cleaning and repairing magical mirrors',
                    service_type: 'Fixed',
                    default_rate: 150.00,
                    unit_of_measure: 'Service',
                    category_id: knex('service_categories').where({ tenant: '11111111-1111-1111-1111-111111111111', category_name: 'Security Services' }).select('category_id').first()
                },
                {
                    tenant: '11111111-1111-1111-1111-111111111111',
                    service_name: 'Shrinking Potion',
                    description: 'Potion to reduce size',
                    service_type: 'Usage',
                    default_rate: 25.00,
                    unit_of_measure: 'Dose',
                    category_id: knex('service_categories').where({ tenant: '11111111-1111-1111-1111-111111111111', category_name: 'Cloud Services' }).select('category_id').first()
                },
                {
                    tenant: '11111111-1111-1111-1111-111111111111',
                    service_name: 'Yellow Brick Road Repair',
                    description: 'Fixing and maintaining the yellow brick road',
                    service_type: 'Time',
                    default_rate: 100.00,
                    unit_of_measure: 'Hour',
                    category_id: knex('service_categories').where({ tenant: '11111111-1111-1111-1111-111111111111', category_name: 'Network Services' }).select('category_id').first()
                },
                {
                    tenant: '11111111-1111-1111-1111-111111111111',
                    service_name: 'Emerald City Security',
                    description: '24/7 magical security for Emerald City',
                    service_type: 'Fixed',
                    default_rate: 5000.00,
                    unit_of_measure: 'Month',
                    category_id: knex('service_categories').where({ tenant: '11111111-1111-1111-1111-111111111111', category_name: 'Security Services' }).select('category_id').first()
                }
            ]);
        });
};