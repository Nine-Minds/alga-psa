const { randomUUID } = require('crypto');

exports.seed = async function seed(knex) {
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    const dorothyContactId = randomUUID();
    const aliceContactId = randomUUID();

    await knex('contacts').insert([
        {
            tenant: tenant.tenant,
            contact_name_id: dorothyContactId,
            full_name: 'Dorothy Gale',
            client_id: knex('clients')
                .where({
                    tenant: tenant.tenant,
                    client_name: 'Emerald City'
                })
                .select('client_id')
                .first(),
            email: 'dorothy@oz.com',
            primary_email_canonical_type: 'work',
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
        },
        {
            tenant: tenant.tenant,
            contact_name_id: aliceContactId,
            full_name: 'Alice in Wonderland',
            client_id: knex('clients')
                .where({
                    tenant: tenant.tenant,
                    client_name: 'Wonderland'
                })
                .select('client_id')
                .first(),
            email: 'alice@wonderland.com',
            primary_email_canonical_type: 'personal',
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
        }
    ]);

    await knex('contact_additional_email_addresses').insert([
        {
            tenant: tenant.tenant,
            contact_additional_email_address_id: randomUUID(),
            contact_name_id: dorothyContactId,
            email_address: 'dorothy.billing@oz.com',
            canonical_type: 'billing',
            display_order: 0,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
        }
    ]);

    await knex('contact_phone_numbers').insert([
        {
            tenant: tenant.tenant,
            contact_name_id: dorothyContactId,
            contact_phone_number_id: randomUUID(),
            phone_number: '+1-555-987-6543',
            canonical_type: 'work',
            is_default: true,
            display_order: 0,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
        },
        {
            tenant: tenant.tenant,
            contact_name_id: aliceContactId,
            contact_phone_number_id: randomUUID(),
            phone_number: '+1-555-246-8135',
            canonical_type: 'work',
            is_default: true,
            display_order: 0,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
        }
    ]);
};
