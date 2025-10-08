exports.seed = function(knex) {
    // Deletes ALL existing entries
    return knex('tenants').del()
      .then(function () {
        // Inserts seed entries
        return knex('tenants').insert([
          {
            tenant: knex.raw('gen_random_uuid()'),
            client_name: 'Oz',
            phone_number: '123-456-7899',
            email: 'oz@example.com',
            created_at: knex.fn.now(),
            payment_platform_id: 'platform-123-abc',
            payment_method_id: 'method-456-def',
            auth_service_id: 'auth-789',
            plan: 'pro'
          }
        ]);
      });
  };
