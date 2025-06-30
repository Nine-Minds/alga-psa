exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            
            // Delete existing categories first
            return knex('categories').where({ tenant: tenant.tenant }).del()
                .then(() => {
                    // Insert parent categories
                    return knex('categories').insert([
                        {
                            tenant: tenant.tenant,
                            category_name: 'Magical Artifacts',
                            display_order: 1,
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
                            display_order: 2,
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
                            display_order: 3,
                            channel_id: knex('channels')
                                .where({
                                    tenant: tenant.tenant,
                                    channel_name: 'Technical Issues'
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
                            display_order: 4,
                            channel_id: knex('channels')
                                .where({
                                    tenant: tenant.tenant,
                                    channel_name: 'General Support'
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
                            display_order: 5,
                            channel_id: knex('channels')
                                .where({
                                    tenant: tenant.tenant,
                                    channel_name: 'Projects'
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
                    ]);
                })
                .then(() => {
                    // Insert subcategories
                    return knex('categories').insert([
                        // Magical Artifacts subcategories
                        {
                            tenant: tenant.tenant,
                            category_name: 'Enchanted Accessories',
                            display_order: 1,
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
                            display_order: 2,
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
                        
                        // Creature Encounters subcategories
                        {
                            tenant: tenant.tenant,
                            category_name: 'Talking Animals',
                            display_order: 1,
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
                            display_order: 2,
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
                        
                        // Landscape Anomalies subcategories
                        {
                            tenant: tenant.tenant,
                            category_name: 'Impossible Geography',
                            display_order: 1,
                            channel_id: knex('channels')
                                .where({
                                    tenant: tenant.tenant,
                                    channel_name: 'Technical Issues'
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
                            display_order: 2,
                            channel_id: knex('channels')
                                .where({
                                    tenant: tenant.tenant,
                                    channel_name: 'Technical Issues'
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
                        
                        // Character Assistance subcategories
                        {
                            tenant: tenant.tenant,
                            category_name: 'Quest Guidance',
                            display_order: 1,
                            channel_id: knex('channels')
                                .where({
                                    tenant: tenant.tenant,
                                    channel_name: 'General Support'
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
                            display_order: 2,
                            channel_id: knex('channels')
                                .where({
                                    tenant: tenant.tenant,
                                    channel_name: 'General Support'
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
                        
                        // Realm Maintenance subcategories
                        {
                            tenant: tenant.tenant,
                            category_name: 'Portal Management',
                            display_order: 1,
                            channel_id: knex('channels')
                                .where({
                                    tenant: tenant.tenant,
                                    channel_name: 'Projects'
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
                            display_order: 2,
                            channel_id: knex('channels')
                                .where({
                                    tenant: tenant.tenant,
                                    channel_name: 'Projects'
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
                    ]);
                });
        });
};