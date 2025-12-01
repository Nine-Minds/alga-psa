exports.seed = async function(knex) {
    // Use TRUNCATE CASCADE to properly handle foreign key constraints
    // This will delete all tenant data and any dependent records (users, etc.)
    await knex.raw('TRUNCATE TABLE tenants CASCADE');

    // Insert seed entries
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
  };
