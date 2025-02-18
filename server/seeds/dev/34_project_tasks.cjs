exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('project_tasks').insert([
                {
                    tenant: tenant.tenant,
                    phase_id: knex('project_phases').where({ 
                        tenant: tenant.tenant, 
                        phase_name: 'Territory Survey' 
                    }).select('phase_id').first(),
                    task_name: 'Map New Areas',
                    description: 'Create detailed maps of newly discovered areas',
                    assigned_to: knex('users').where({ 
                        tenant: tenant.tenant, 
                        username: 'glinda' 
                    }).select('user_id').first(),
                    estimated_hours: 40,
                    actual_hours: 35,
                    status_id: knex('statuses').where({ 
                        tenant: tenant.tenant, 
                        name: 'Magic Accomplished' 
                    }).select('status_id').first(),
                    wbs_code: '1.1.1'
                },
                {
                    tenant: tenant.tenant,
                    phase_id: knex('project_phases').where({ 
                        tenant: tenant.tenant, 
                        phase_name: 'Infrastructure Planning' 
                    }).select('phase_id').first(),
                    task_name: 'Design Road Network',
                    description: 'Planning road network for Wonderland expansion',
                    assigned_to: knex('users').where({ 
                        tenant: tenant.tenant, 
                        username: 'glinda' 
                    }).select('user_id').first(),
                    estimated_hours: 60,
                    actual_hours: null,
                    status_id: knex('statuses').where({ 
                        tenant: tenant.tenant, 
                        name: 'Wand-Waving' 
                    }).select('status_id').first(),
                    wbs_code: '1.2.1'
                },
                {
                    tenant: tenant.tenant,
                    phase_id: knex('project_phases').where({ 
                        tenant: tenant.tenant, 
                        phase_name: 'Green Space Enhancement' 
                    }).select('phase_id').first(),
                    task_name: 'Plant Magical Flowers',
                    description: 'Plant new species of magical flowers in Emerald City parks',
                    assigned_to: knex('users').where({ 
                        tenant: tenant.tenant, 
                        username: 'glinda' 
                    }).select('user_id').first(),
                    estimated_hours: 20,
                    actual_hours: 15,
                    status_id: knex('statuses').where({ 
                        tenant: tenant.tenant, 
                        name: 'Brewing Potion' 
                    }).select('status_id').first(),
                    wbs_code: '2.1.1'
                }
            ]);
        });
};