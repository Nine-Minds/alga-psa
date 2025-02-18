exports.seed = function(knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('users').insert([
                {
                    tenant: tenant.tenant,
                    username: 'glinda',
                    hashed_password: 'KIXQJZT7qLBlZB6rHn9e1uuEIYVVbIilJ', 
                    first_name: 'Glinda',
                    last_name: 'Good',
                    email: 'glinda@emeraldcity.oz',
                    auth_method: 'magic',
                    created_at: knex.fn.now()
                },
                {
                    tenant: tenant.tenant,
                    username: 'dorothy',
                    hashed_password: 'LMNOQRST8pMCmD7sIn0f2vvFJZWWcJjmK',
                    first_name: 'Dorothy', 
                    last_name: 'Gale',
                    email: 'dorothy@kansas.oz',
                    auth_method: 'ruby_slippers',
                    created_at: knex.fn.now()
                },
                {
                    tenant: tenant.tenant,
                    username: 'scarecrow',
                    hashed_password: 'PQRSTUVW9qNDnE8tJo1g3wwGKAXXdKknL',
                    first_name: 'Scarecrow',
                    last_name: 'Brainless', 
                    email: 'scarecrow@cornfield.oz',
                    auth_method: 'straw',
                    created_at: knex.fn.now()
                },
                {
                    tenant: tenant.tenant,
                    username: 'tinman',
                    hashed_password: 'H34rtL3ssT1n',
                    first_name: 'Tin',
                    last_name: 'Woodman',
                    email: 'tinman@emeraldcity.oz',
                    auth_method: 'password', 
                    created_at: knex.fn.now()
                },
                {
                    tenant: tenant.tenant,
                    username: 'madhatter',
                    hashed_password: 'T34T1m3P4rty!',
                    first_name: 'Mad',
                    last_name: 'Hatter',
                    email: 'hatter@wonderland.com',
                    auth_method: 'password',
                    created_at: knex.fn.now()
                },
                {
                    tenant: tenant.tenant,
                    username: 'cheshire',
                    hashed_password: 'Gr1nC4t789!',
                    first_name: 'Cheshire',
                    last_name: 'Cat',
                    email: 'cheshire@wonderland.com',
                    auth_method: 'password',
                    created_at: knex.fn.now()
                },
                {
                    tenant: tenant.tenant,
                    username: 'queenhearts', 
                    hashed_password: 'H34d50ff123!',
                    first_name: 'Queen',
                    last_name: 'Hearts',
                    email: 'queen@wonderland.com',
                    auth_method: 'password',
                    created_at: knex.fn.now()
                }
            ]);
        });
};
