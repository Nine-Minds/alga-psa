exports.up = async function(knex) {
    // Add order_key to project_phases (replace order_number for sorting)
    await knex.schema.alterTable('project_phases', table => {
        table.string('order_key', 255);
        table.index(['tenant', 'project_id', 'order_key']);
    });
    
    // Add order_key to project_tasks
    await knex.schema.alterTable('project_tasks', table => {
        table.string('order_key', 255);
        table.index(['tenant', 'phase_id', 'project_status_mapping_id', 'order_key']);
    });
    
    // Populate initial order_keys based on existing order
    const { generateKeyBetween } = await import('fractional-indexing');
    
    // Get all tenants
    const tenants = await knex('tenants').select('tenant');
    
    for (const { tenant } of tenants) {
        // Update phases
        const phases = await knex('project_phases')
            .where({ tenant })
            .orderBy('order_number') // Assuming order_number dictates current explicit order
            .select('phase_id', 'tenant', 'project_id');
        
        // Group phases by project
        const phasesByProject = {};
        phases.forEach(phase => {
            if (!phasesByProject[phase.project_id]) {
                phasesByProject[phase.project_id] = [];
            }
            phasesByProject[phase.project_id].push(phase);
        });
        
        // Generate order keys for each project's phases
        for (const projectId in phasesByProject) {
            let lastKeyPhase = null;
            for (const phase of phasesByProject[projectId]) {
                const newKey = generateKeyBetween(lastKeyPhase, null);
                await knex('project_phases')
                    .where({ phase_id: phase.phase_id, tenant: phase.tenant })
                    .update({ order_key: newKey });
                lastKeyPhase = newKey;
            }
        }
        
        // Update tasks grouped by phase and status (current sort order)
        const tasks = await knex('project_tasks')
            .where({ tenant })
            .orderBy(['phase_id', 'project_status_mapping_id', 'wbs_code']) // wbs_code as fallback for initial order within a status
            .select('task_id', 'tenant', 'phase_id', 'project_status_mapping_id');
        
        const groupedTasks = {};
        tasks.forEach(task => {
            const key = `${task.phase_id}-${task.project_status_mapping_id}`;
            if (!groupedTasks[key]) groupedTasks[key] = [];
            groupedTasks[key].push(task);
        });
        
        for (const group of Object.values(groupedTasks)) {
            let lastKeyTask = null;
            for (const task of group) {
                const newKey = generateKeyBetween(lastKeyTask, null);
                await knex('project_tasks')
                    .where({ task_id: task.task_id, tenant: task.tenant })
                    .update({ order_key: newKey });
                lastKeyTask = newKey;
            }
        }
    }
};

exports.down = async function(knex) {
    await knex.schema.alterTable('project_phases', table => {
        table.dropIndex(['tenant', 'project_id', 'order_key']);
        table.dropColumn('order_key');
    });
    
    await knex.schema.alterTable('project_tasks', table => {
        table.dropIndex(['tenant', 'phase_id', 'project_status_mapping_id', 'order_key']);
        table.dropColumn('order_key');
    });
};