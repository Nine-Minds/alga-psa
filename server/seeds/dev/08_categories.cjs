exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return Promise.all([
                // Insert categories
                knex('categories').insert([
                    {
                        tenant: tenant.tenant,
                        category_name: 'Magical Artifacts',
                        channel_id: knex('channels')
                            .where({
                                tenant: tenant.tenant,
                                channel_name: 'Urgent Matters'
                            })
                            .select('channel_id'),
                        created_by: knex('users')
                            .where({
                                tenant: tenant.tenant,
                                username: 'glinda'
                            })
                            .select('user_id')
                            .first()
                    },
                    {
                        tenant: tenant.tenant,
                        category_name: 'Creature Encounters',
                        channel_id: knex('channels')
                            .where({
                                tenant: tenant.tenant,
                                channel_name: 'Urgent Matters'
                            })
                            .select('channel_id'),
                        created_by: knex('users')
                            .where({
                                tenant: tenant.tenant,
                                username: 'glinda'
                            })
                            .select('user_id')
                            .first()
                    },
                    {
                        tenant: tenant.tenant,
                        category_name: 'Landscape Anomalies',
                        channel_id: knex('channels')
                            .where({
                                tenant: tenant.tenant,
                                channel_name: 'Urgent Matters'
                            })
                            .select('channel_id'),
                        created_by: knex('users')
                            .where({
                                tenant: tenant.tenant,
                                username: 'glinda'
                            })
                            .select('user_id')
                            .first()
                    },
                    {
                        tenant: tenant.tenant,
                        category_name: 'Character Assistance',
                        channel_id: knex('channels')
                            .where({
                                tenant: tenant.tenant,
                                channel_name: 'Urgent Matters'
                            })
                            .select('channel_id'),
                        created_by: knex('users')
                            .where({
                                tenant: tenant.tenant,
                                username: 'glinda'
                            })
                            .select('user_id')
                            .first()
                    },
                    {
                        tenant: tenant.tenant,
                        category_name: 'Realm Maintenance',
                        channel_id: knex('channels')
                            .where({
                                tenant: tenant.tenant,
                                channel_name: 'Urgent Matters'
                            })
                            .select('channel_id'),
                        created_by: knex('users')
                            .where({
                                tenant: tenant.tenant,
                                username: 'glinda'
                            })
                            .select('user_id')
                            .first()
                    }
                ]),

                // Insert subcategories
                knex('categories').insert([
                    {
                        tenant: tenant.tenant,
                        category_name: 'Enchanted Accessories',
                        channel_id: knex('channels')
                            .where({
                                tenant: tenant.tenant,
                                channel_name: 'Urgent Matters'
                            })
                            .select('channel_id'),
                        parent_category: knex('categories')
                            .where({
                                tenant: tenant.tenant,
                                category_name: 'Magical Artifacts'
                            })
                            .select('category_id')
                            .first(),
                        created_by: knex('users')
                            .where({
                                tenant: tenant.tenant,
                                username: 'glinda'
                            })
                            .select('user_id')
                            .first()
                    },
                    {
                        tenant: tenant.tenant,
                        category_name: 'Potions and Elixirs',
                        channel_id: knex('channels')
                            .where({
                                tenant: tenant.tenant,
                                channel_name: 'Urgent Matters'
                            })
                            .select('channel_id'),
                        parent_category: knex('categories')
                            .where({
                                tenant: tenant.tenant,
                                category_name: 'Magical Artifacts'
                            })
                            .select('category_id')
                            .first(),
                        created_by: knex('users')
                            .where({
                                tenant: tenant.tenant,
                                username: 'glinda'
                            })
                            .select('user_id')
                            .first()
                    },
                    {
                        tenant: tenant.tenant,
                        category_name: 'Talking Animals',
                        channel_id: knex('channels')
                            .where({
                                tenant: tenant.tenant,
                                channel_name: 'Urgent Matters'
                            })
                            .select('channel_id'),
                        parent_category: knex('categories')
                            .where({
                                tenant: tenant.tenant,
                                category_name: 'Creature Encounters'
                            })
                            .select('category_id')
                            .first(),
                        created_by: knex('users')
                            .where({
                                tenant: tenant.tenant,
                                username: 'glinda'
                            })
                            .select('user_id')
                            .first()
                    },
                    {
                        tenant: tenant.tenant,
                        category_name: 'Mythical Beings',
                        channel_id: knex('channels')
                            .where({
                                tenant: tenant.tenant,
                                channel_name: 'Urgent Matters'
                            })
                            .select('channel_id'),
                        parent_category: knex('categories')
                            .where({
                                tenant: tenant.tenant,
                                category_name: 'Creature Encounters'
                            })
                            .select('category_id')
                            .first(),
                        created_by: knex('users')
                            .where({
                                tenant: tenant.tenant,
                                username: 'glinda'
                            })
                            .select('user_id')
                            .first()
                    },
                    {
                        tenant: tenant.tenant,
                        category_name: 'Impossible Geography',
                        channel_id: knex('channels')
                            .where({
                                tenant: tenant.tenant,
                                channel_name: 'Urgent Matters'
                            })
                            .select('channel_id'),
                        parent_category: knex('categories')
                            .where({
                                tenant: tenant.tenant,
                                category_name: 'Landscape Anomalies'
                            })
                            .select('category_id')
                            .first(),
                        created_by: knex('users')
                            .where({
                                tenant: tenant.tenant,
                                username: 'glinda'
                            })
                            .select('user_id')
                            .first()
                    },
                    {
                        tenant: tenant.tenant,
                        category_name: 'Weather Oddities',
                        channel_id: knex('channels')
                            .where({
                                tenant: tenant.tenant,
                                channel_name: 'Urgent Matters'
                            })
                            .select('channel_id'),
                        parent_category: knex('categories')
                            .where({
                                tenant: tenant.tenant,
                                category_name: 'Landscape Anomalies'
                            })
                            .select('category_id')
                            .first(),
                        created_by: knex('users')
                            .where({
                                tenant: tenant.tenant,
                                username: 'glinda'
                            })
                            .select('user_id')
                            .first()
                    },
                    {
                        tenant: tenant.tenant,
                        category_name: 'Quest Guidance',
                        channel_id: knex('channels')
                            .where({
                                tenant: tenant.tenant,
                                channel_name: 'Urgent Matters'
                            })
                            .select('channel_id'),
                        parent_category: knex('categories')
                            .where({
                                tenant: tenant.tenant,
                                category_name: 'Character Assistance'
                            })
                            .select('category_id')
                            .first(),
                        created_by: knex('users')
                            .where({
                                tenant: tenant.tenant,
                                username: 'glinda'
                            })
                            .select('user_id')
                            .first()
                    },
                    {
                        tenant: tenant.tenant,
                        category_name: 'Magical Transformations',
                        channel_id: knex('channels')
                            .where({
                                tenant: tenant.tenant,
                                channel_name: 'Urgent Matters'
                            })
                            .select('channel_id'),
                        parent_category: knex('categories')
                            .where({
                                tenant: tenant.tenant,
                                category_name: 'Character Assistance'
                            })
                            .select('category_id')
                            .first(),
                        created_by: knex('users')
                            .where({
                                tenant: tenant.tenant,
                                username: 'glinda'
                            })
                            .select('user_id')
                            .first()
                    },
                    {
                        tenant: tenant.tenant,
                        category_name: 'Portal Management',
                        channel_id: knex('channels')
                            .where({
                                tenant: tenant.tenant,
                                channel_name: 'Urgent Matters'
                            })
                            .select('channel_id'),
                        parent_category: knex('categories')
                            .where({
                                tenant: tenant.tenant,
                                category_name: 'Realm Maintenance'
                            })
                            .select('category_id')
                            .first(),
                        created_by: knex('users')
                            .where({
                                tenant: tenant.tenant,
                                username: 'glinda'
                            })
                            .select('user_id')
                            .first()
                    },
                    {
                        tenant: tenant.tenant,
                        category_name: 'Magical Infrastructure',
                        channel_id: knex('channels')
                            .where({
                                tenant: tenant.tenant,
                                channel_name: 'Urgent Matters'
                            })
                            .select('channel_id'),
                        parent_category: knex('categories')
                            .where({
                                tenant: tenant.tenant,
                                category_name: 'Realm Maintenance'
                            })
                            .select('category_id')
                            .first(),
                        created_by: knex('users')
                            .where({
                                tenant: tenant.tenant,
                                username: 'glinda'
                            })
                            .select('user_id')
                            .first()
                    }
                ])
            ]);
        });
};
