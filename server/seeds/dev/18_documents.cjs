exports.seed = async function (knex) {
    // Get tenant first
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    // Insert documents
    const documents = await knex('documents')
        .insert([
            {
                tenant: tenant.tenant,
                document_name: 'Alice Lost White Rabbit',
                type_id: knex('document_types')
                    .where({
                        tenant: tenant.tenant,
                        type_name: 'Ticket'
                    })
                    .select('type_id')
                    .first(),
                user_id: knex('users')
                    .where({
                        tenant: tenant.tenant,
                        username: 'glinda'
                    })
                    .select('user_id')
                    .first(),
                created_by: knex('users')
                    .where({
                        tenant: tenant.tenant,
                        username: 'glinda'
                    })
                    .select('user_id')
                    .first(),
                entered_at: knex.fn.now(),
                content: 'Searched for White Rabbit in Wonderland. No luck yet.'
            },
            {
                tenant: tenant.tenant,
                document_name: 'Company Profile',
                type_id: knex('document_types')
                    .where({
                        tenant: tenant.tenant,
                        type_name: 'Company'
                    })
                    .select('type_id')
                    .first(),
                user_id: knex('users')
                    .where({
                        tenant: tenant.tenant,
                        username: 'glinda'
                    })
                    .select('user_id')
                    .first(),
                created_by: knex('users')
                    .where({
                        tenant: tenant.tenant,
                        username: 'glinda'
                    })
                    .select('user_id')
                    .first(),
                entered_at: knex.fn.now(),
                content: 'Wonderland Company Profile and Details'
            },
            {
                tenant: tenant.tenant,
                document_name: 'White Rabbit Search Plan',
                type_id: knex('document_types')
                    .where({
                        tenant: tenant.tenant,
                        type_name: 'Ticket'
                    })
                    .select('type_id')
                    .first(),
                user_id: knex('users')
                    .where({
                        tenant: tenant.tenant,
                        username: 'glinda'
                    })
                    .select('user_id')
                    .first(),
                created_by: knex('users')
                    .where({
                        tenant: tenant.tenant,
                        username: 'glinda'
                    })
                    .select('user_id')
                    .first(),
                entered_at: knex.fn.now(),
                content: `Further actions for White Rabbit search:
                    1. Check the rabbit hole near the old oak tree.
                    2. Interview the Cheshire Cat for possible sightings.
                    3. Set up carrot traps in key locations around Wonderland.
                    4. Distribute "Missing Rabbit" posters with detailed description and time-keeping habits.
                    5. Investigate any reports of pocket watch ticking in unusual places.
                    6. Coordinate with the Queen of Hearts'' guards for a palace grounds search.
                    7. Monitor all tea parties for any signs of the White Rabbit.
                    8. Check with the Mad Hatter for any recent hat orders fitting the White Rabbit''s size.
                    9. Explore the Tulgey Wood, a known shortcut for hurried rabbits.
                    10. Set up a hotline for Wonderland residents to report any rabbit sightings.`
            }
        ])
        .returning(['document_id']);

    // Get the ticket ID we want to associate with
    const ticketId = await knex('tickets')
        .where({
            tenant: tenant.tenant,
            title: 'Lost White Rabbit'
        })
        .select('ticket_id')
        .first();

    // Get the company ID we want to associate with
    const companyId = await knex('companies')
        .where({
            tenant: tenant.tenant,
            company_name: 'Wonderland Inc'
        })
        .select('company_id')
        .first();

    // Create associations if we have the related entities
    const associations = [];

    if (ticketId) {
        associations.push(
            {
                tenant: tenant.tenant,
                document_id: documents[0].document_id,
                entity_id: ticketId.ticket_id,
                entity_type: 'ticket'
            },
            {
                tenant: tenant.tenant,
                document_id: documents[2].document_id,
                entity_id: ticketId.ticket_id,
                entity_type: 'ticket'
            }
        );
    }

    if (companyId) {
        associations.push({
            tenant: tenant.tenant,
            document_id: documents[1].document_id,
            entity_id: companyId.company_id,
            entity_type: 'company'
        });
    }

    if (associations.length > 0) {
        await knex('document_associations').insert(associations);
    }
};
