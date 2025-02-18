exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('project_ticket_links').insert([
                {
                    tenant: tenant.tenant,
                    project_id: knex('projects').where({ 
                        tenant: tenant.tenant, 
                        project_name: 'Wonderland Expansion' 
                    }).select('project_id').first(),
                    phase_id: knex('project_phases').where({ 
                        tenant: tenant.tenant, 
                        phase_name: 'Territory Survey' 
                    }).select('phase_id').first(),
                    task_id: knex('project_tasks').where({ 
                        tenant: tenant.tenant, 
                        task_name: 'Map New Areas' 
                    }).select('task_id').first(),
                    ticket_id: knex('tickets').where({ 
                        tenant: tenant.tenant, 
                        title: 'Survey Uncharted Areas in Wonderland' 
                    }).select('ticket_id').first()
                },
                {
                    tenant: tenant.tenant,
                    project_id: knex('projects').where({ 
                        tenant: tenant.tenant, 
                        project_name: 'Emerald City Beautification' 
                    }).select('project_id').first(),
                    phase_id: knex('project_phases').where({ 
                        tenant: tenant.tenant, 
                        phase_name: 'Green Space Enhancement' 
                    }).select('phase_id').first(),
                    task_id: knex('project_tasks').where({ 
                        tenant: tenant.tenant, 
                        task_name: 'Plant Magical Flowers' 
                    }).select('task_id').first(),
                    ticket_id: knex('tickets').where({ 
                        tenant: tenant.tenant, 
                        title: 'Enhance Emerald City Gardens' 
                    }).select('ticket_id').first()
                }
            ]);
        });
};