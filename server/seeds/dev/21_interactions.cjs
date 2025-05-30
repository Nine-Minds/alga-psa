exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then(async (tenant) => {
            if (!tenant) return;
            
            // Get status IDs for the tenant
            const completedStatus = await knex('statuses')
                .where({ tenant: tenant.tenant, status_type: 'interaction', name: 'Emerald Communication' })
                .select('status_id').first();
            const plannedStatus = await knex('statuses')
                .where({ tenant: tenant.tenant, status_type: 'interaction', name: 'Crystal Ball Awaiting' })
                .select('status_id').first();
            const inProgressStatus = await knex('statuses')
                .where({ tenant: tenant.tenant, status_type: 'interaction', name: 'Yellow Brick Chat' })
                .select('status_id').first();

            return knex('interactions').insert([
                {
                    tenant: tenant.tenant,
                    type_id: knex('system_interaction_types').where({ type_name: 'Call' }).select('type_id').first(),
                    contact_name_id: knex('contacts').where({ tenant: tenant.tenant }).whereRaw("full_name ILIKE '%alice%'").select('contact_name_id').first(),
                    company_id: knex('companies').where({ tenant: tenant.tenant, company_name: 'Wonderland' }).select('company_id').first(),
                    user_id: knex('users').where({ tenant: tenant.tenant, username: 'glinda' }).select('user_id').first(),
                    ticket_id: knex('tickets').where({ tenant: tenant.tenant, title: 'Missing White Rabbit' }).select('ticket_id').first(),
                    title: 'White Rabbit Investigation Call',
                    notes: 'Discussed details about the missing White Rabbit. Alice mentioned last seeing him near the tea party table around 3 PM. She suspects he might be hiding in one of the underground tunnels. Need to schedule a follow-up search.',
                    interaction_date: knex.raw("CURRENT_TIMESTAMP - INTERVAL '1 day'"),
                    start_time: knex.raw("CURRENT_TIMESTAMP - INTERVAL '1 day' - INTERVAL '15 minutes'"),
                    end_time: knex.raw("CURRENT_TIMESTAMP - INTERVAL '1 day'"),
                    duration: 15,
                    status_id: completedStatus?.status_id
                },
                {
                    tenant: tenant.tenant,
                    type_id: knex('system_interaction_types').where({ type_name: 'Email' }).select('type_id').first(),
                    contact_name_id: knex('contacts').where({ tenant: tenant.tenant }).whereRaw("full_name ILIKE '%alice%'").select('contact_name_id').first(),
                    company_id: knex('companies').where({ tenant: tenant.tenant, company_name: 'Wonderland' }).select('company_id').first(),
                    user_id: knex('users').where({ tenant: tenant.tenant, username: 'glinda' }).select('user_id').first(),
                    ticket_id: knex('tickets').where({ tenant: tenant.tenant, title: 'Missing White Rabbit' }).select('ticket_id').first(),
                    title: 'Possible White Rabbit Locations',
                    notes: 'Sent comprehensive email with map of possible White Rabbit hiding spots including:\n- The Mad Hatter\'s tea table\n- Queen\'s rose garden maze\n- Cheshire Cat\'s tree\n- Underground tunnel system\n\nRequested Alice to check these locations systematically.',
                    interaction_date: knex.raw("CURRENT_TIMESTAMP - INTERVAL '12 hours'"),
                    start_time: knex.raw("CURRENT_TIMESTAMP - INTERVAL '12 hours' - INTERVAL '5 minutes'"),
                    end_time: knex.raw("CURRENT_TIMESTAMP - INTERVAL '12 hours'"),
                    duration: 5,
                    status_id: completedStatus?.status_id
                },
                {
                    tenant: tenant.tenant,
                    type_id: knex('system_interaction_types').where({ type_name: 'Meeting' }).select('type_id').first(),
                    contact_name_id: knex('contacts').where({ tenant: tenant.tenant }).whereRaw("full_name ILIKE '%dorothy%'").select('contact_name_id').first(),
                    company_id: knex('companies').where({ tenant: tenant.tenant, company_name: 'Emerald City' }).select('company_id').first(),
                    user_id: knex('users').where({ tenant: tenant.tenant, username: 'glinda' }).select('user_id').first(),
                    ticket_id: null,
                    title: 'Emerald City Security Review',
                    notes: 'Scheduled comprehensive security meeting to review:\n- Current guard rotations\n- Yellow brick road access controls\n- Wizard\'s chamber security protocols\n- Flying monkey intrusion prevention\n\nAgenda and security assessment documents to be prepared beforehand.',
                    interaction_date: knex.raw("CURRENT_TIMESTAMP + INTERVAL '2 days'"),
                    start_time: knex.raw("CURRENT_TIMESTAMP + INTERVAL '2 days'"),
                    end_time: knex.raw("CURRENT_TIMESTAMP + INTERVAL '2 days' + INTERVAL '1 hour'"),
                    duration: 60,
                    status_id: plannedStatus?.status_id
                },
                {
                    tenant: tenant.tenant,
                    type_id: knex('system_interaction_types').where({ type_name: 'Note' }).select('type_id').first(),
                    contact_name_id: knex('contacts').where({ tenant: tenant.tenant }).whereRaw("full_name ILIKE '%alice%'").select('contact_name_id').first(),
                    company_id: knex('companies').where({ tenant: tenant.tenant, company_name: 'Wonderland' }).select('company_id').first(),
                    user_id: knex('users').where({ tenant: tenant.tenant, username: 'glinda' }).select('user_id').first(),
                    ticket_id: knex('tickets').where({ tenant: tenant.tenant, title: 'Missing White Rabbit' }).select('ticket_id').first(),
                    title: 'White Rabbit Sighting Update',
                    notes: 'BREAKING: White Rabbit spotted near the tea party location at approximately 2:30 PM today. Witness reports he was checking his pocket watch frantically and muttering about being "terribly late." He disappeared down a rabbit hole before anyone could approach. Recommended immediate investigation of that specific tunnel entrance.',
                    interaction_date: knex.raw("CURRENT_TIMESTAMP - INTERVAL '6 hours'"),
                    start_time: knex.raw("CURRENT_TIMESTAMP - INTERVAL '6 hours'"),
                    end_time: knex.raw("CURRENT_TIMESTAMP - INTERVAL '6 hours'"),
                    duration: null,
                    status_id: completedStatus?.status_id
                },
                {
                    tenant: tenant.tenant,
                    type_id: knex('system_interaction_types').where({ type_name: 'Call' }).select('type_id').first(),
                    contact_name_id: knex('contacts').where({ tenant: tenant.tenant }).whereRaw("full_name ILIKE '%dorothy%'").select('contact_name_id').first(),
                    company_id: knex('companies').where({ tenant: tenant.tenant, company_name: 'Emerald City' }).select('company_id').first(),
                    user_id: knex('users').where({ tenant: tenant.tenant, username: 'glinda' }).select('user_id').first(),
                    ticket_id: null,
                    title: 'Ongoing Ruby Slippers Maintenance',
                    notes: 'Currently coordinating with Dorothy about the ruby slippers\' magical maintenance schedule. Discussion in progress about power calibration and transportation safety protocols.',
                    interaction_date: knex.raw("CURRENT_TIMESTAMP"),
                    start_time: knex.raw("CURRENT_TIMESTAMP - INTERVAL '10 minutes'"),
                    end_time: null,
                    duration: null,
                    status_id: inProgressStatus?.status_id
                }]);
        });
};
