exports.seed = async function (knex) {
    // Fetch the tenant first
    const tenantRow = await knex('tenants').select('tenant').first();
    if (!tenantRow) {
        console.warn('No tenant found, skipping ticket seeding.');
        return;
    }
    const tenant = tenantRow.tenant;

    // Helper function to fetch IDs to reduce repetition
    const getId = async (table, filters, idColumn) => {
        const result = await knex(table).where({ tenant, ...filters }).select(idColumn).first();
        if (!result) {
            console.warn(`Warning: Could not find ID in table '${table}' for filters:`, filters);
            return null; // Or throw an error if required
        }
        return result[idColumn];
    };

    const getContactId = async (namePattern) => {
        const result = await knex('contacts')
            .where({ tenant })
            .whereRaw(`full_name ILIKE ?`, [`%${namePattern}%`])
            .select('contact_name_id')
            .first();
        if (!result) {
            console.warn(`Warning: Could not find contact ID for pattern: ${namePattern}`);
            return null;
        }
        return result.contact_name_id;
    }

    // Fetch all required IDs concurrently for efficiency
    const [
        clientEmeraldCityId, clientWonderlandId,
        contactAliceId, contactDorothyId,
        statusCuriousId, statusAwaitingId, statusUnfoldingId,
        boardUrgentId, boardProjectsId,
        categoryMagicalArtifactsId, categoryCharacterAssistId, categoryRealmMaintenanceId,
        subCategoryEnchantedAccId, subCategoryQuestGuidanceId, subCategoryMagicalInfraId,
        priorityEnchantedId, priorityCuriousId,
        severitySeriousId, severityModerateId,
        urgencyHareId, urgencyTickTockId,
        impactRealmId, impactLocalId,
        userGlindaId, userTinmanId, userMadhatterId, userScarecrowId
    ] = await Promise.all([
        getId('clients', { client_name: 'Emerald City' }, 'client_id'),
        getId('clients', { client_name: 'Wonderland' }, 'client_id'),
        getContactId('alice'),
        getContactId('dorothy'),
        getId('statuses', { name: 'Curious Beginning' }, 'status_id'),
        getId('statuses', { name: 'Awaiting Wisdom' }, 'status_id'),
        getId('statuses', { name: 'Unfolding Adventure' }, 'status_id'),
        getId('boards', { board_name: 'Urgent Matters' }, 'board_id'),
        getId('boards', { board_name: 'Projects' }, 'board_id'),
        getId('categories', { category_name: 'Magical Artifacts' }, 'category_id'),
        getId('categories', { category_name: 'Character Assistance' }, 'category_id'),
        getId('categories', { category_name: 'Realm Maintenance' }, 'category_id'),
        // Assuming subcategories are also in the 'categories' table, identified by name
        getId('categories', { category_name: 'Enchanted Accessories' }, 'category_id'),
        getId('categories', { category_name: 'Quest Guidance' }, 'category_id'),
        getId('categories', { category_name: 'Magical Infrastructure' }, 'category_id'),
        getId('priorities', { priority_name: 'Enchanted Emergency' }, 'priority_id'),
        getId('priorities', { priority_name: 'Curious Conundrum' }, 'priority_id'),
        getId('severities', { severity_name: 'Serious Snarl' }, 'severity_id'),
        getId('severities', { severity_name: 'Moderate Muddle' }, 'severity_id'),
        getId('urgencies', { urgency_name: 'Hare-Paced Hustle' }, 'urgency_id'),
        getId('urgencies', { urgency_name: 'Tick-Tock Task' }, 'urgency_id'),
        getId('impacts', { impact_name: 'Realm-Wide Repercussions' }, 'impact_id'),
        getId('impacts', { impact_name: 'Local Disruption' }, 'impact_id'),
        getId('users', { username: 'glinda' }, 'user_id'),
        getId('users', { username: 'tinman' }, 'user_id'),
        getId('users', { username: 'madhatter' }, 'user_id'),
        getId('users', { username: 'scarecrow' }, 'user_id')
    ]);

    // Prepare ticket data with resolved IDs
    const ticketsToInsert = [
        {
            tenant: tenant,
            title: 'Missing White Rabbit',
            ticket_number: 'TIC1001', // Explicitly included
            client_id: clientEmeraldCityId,
            contact_name_id: contactAliceId,
            status_id: statusCuriousId,
            board_id: boardUrgentId,
            category_id: categoryMagicalArtifactsId,
            subcategory_id: subCategoryEnchantedAccId,
            priority_id: priorityEnchantedId,
            severity_id: severitySeriousId,
            urgency_id: urgencyHareId,
            impact_id: impactRealmId,
            entered_by: userGlindaId,
            assigned_to: userTinmanId,
            entered_at: knex.fn.now()
        },
        {
            tenant: tenant,
            title: 'Survey Uncharted Areas in Wonderland',
            ticket_number: 'TIC1002', // Explicitly included
            client_id: clientWonderlandId,
            contact_name_id: contactAliceId,
            status_id: statusAwaitingId,
            board_id: boardUrgentId,
            category_id: categoryCharacterAssistId,
            subcategory_id: subCategoryQuestGuidanceId,
            priority_id: priorityEnchantedId,
            severity_id: severityModerateId,
            urgency_id: urgencyTickTockId,
            impact_id: impactLocalId,
            entered_by: userGlindaId,
            assigned_to: userMadhatterId,
            entered_at: knex.raw("CURRENT_TIMESTAMP - INTERVAL '2 months'")
        },
        {
            tenant: tenant,
            title: 'Enhance Emerald City Gardens',
            ticket_number: 'TIC1003', // Explicitly included
            client_id: clientEmeraldCityId,
            contact_name_id: contactDorothyId,
            status_id: statusUnfoldingId,
            board_id: boardProjectsId,
            category_id: categoryRealmMaintenanceId,
            subcategory_id: subCategoryMagicalInfraId,
            priority_id: priorityCuriousId,
            severity_id: severityModerateId,
            urgency_id: urgencyTickTockId,
            impact_id: impactLocalId,
            entered_by: userGlindaId,
            assigned_to: userScarecrowId,
            entered_at: knex.raw("CURRENT_TIMESTAMP - INTERVAL '1 month'")
        }
    ];

    // Filter out any tickets where essential IDs might be missing (if lookups failed)
    const validTickets = ticketsToInsert.filter(ticket =>
        ticket.client_id && ticket.contact_name_id && ticket.status_id &&
        ticket.board_id && ticket.category_id && ticket.subcategory_id &&
        ticket.priority_id && ticket.severity_id && ticket.urgency_id &&
        ticket.impact_id && ticket.entered_by && ticket.assigned_to
    );

    if (validTickets.length !== ticketsToInsert.length) {
         console.warn(`Warning: Some tickets were skipped due to missing foreign key IDs.`);
    }

    if (validTickets.length > 0) {
        // Perform the insert one by one to potentially avoid batch insert issues
        console.log(`Attempting to insert ${validTickets.length} tickets individually...`);
        for (const ticket of validTickets) {
            try {
                await knex('tickets').insert(ticket);
            } catch (error) {
                console.error(`Error inserting ticket ${ticket.ticket_number}:`, error);
                console.error('Ticket data:', ticket);
                // Decide if you want to stop on error or continue
                // throw error; // Uncomment to stop on the first error
            }
        }
        console.log(`Finished attempting ticket insertion.`);
    } else {
        console.warn('No valid tickets to insert.');
    }
};


