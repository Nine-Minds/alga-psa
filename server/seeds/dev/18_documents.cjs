const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const documentTypeId = (typeName) => db.table('document_types')
        .where({ type_name: typeName })
        .select('type_id')
        .first();
    const glindaUserId = db.table('users')
        .where({ username: 'glinda' })
        .select('user_id')
        .first();

    // Insert documents
    const documents = await db.table('documents')
        .insert([
            {
                tenant: tenantId,
                document_name: 'Alice Lost White Rabbit',
                type_id: documentTypeId('Ticket'),
                user_id: glindaUserId,
                created_by: glindaUserId,
                entered_at: knex.fn.now(),
                content: 'Searched for White Rabbit in Wonderland. No luck yet.'
            },
            {
                tenant: tenantId,
                document_name: 'Client Profile',
                type_id: documentTypeId('Client'),
                user_id: glindaUserId,
                created_by: glindaUserId,
                entered_at: knex.fn.now(),
                content: 'Wonderland Client Profile and Details'
            },
            {
                tenant: tenantId,
                document_name: 'White Rabbit Search Plan',
                type_id: documentTypeId('Ticket'),
                user_id: glindaUserId,
                created_by: glindaUserId,
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
    const ticketId = await db.table('tickets')
        .where({
            title: 'Lost White Rabbit'
        })
        .select('ticket_id')
        .first();

    // Get the client ID we want to associate with
    const clientId = await db.table('clients')
        .where({
            client_name: 'Wonderland Inc'
        })
        .select('client_id')
        .first();

    // Create associations if we have the related entities
    const associations = [];

    if (ticketId) {
        associations.push(
            {
                tenant: tenantId,
                document_id: documents[0].document_id,
                entity_id: ticketId.ticket_id,
                entity_type: 'ticket'
            },
            {
                tenant: tenantId,
                document_id: documents[2].document_id,
                entity_id: ticketId.ticket_id,
                entity_type: 'ticket'
            }
        );
    }

    if (clientId) {
        associations.push({
            tenant: tenantId,
            document_id: documents[1].document_id,
            entity_id: clientId.client_id,
            entity_type: 'client'
        });
    }

    if (associations.length > 0) {
        await db.table('document_associations').insert(associations);
    }
};
