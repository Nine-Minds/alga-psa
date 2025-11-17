/**
 * Ensure all projects have status mappings and all tasks reference them
 * This migration is idempotent and safe to run multiple times
 */
exports.up = async function(knex) {
  console.log('Starting migration: ensure_project_task_statuses');

  // Step 1: Ensure all projects have status mappings
  console.log('Step 1: Checking projects without status mappings...');

  const projectsWithoutStatuses = await knex('projects as p')
    .leftJoin('project_status_mappings as psm', function() {
      this.on('p.project_id', 'psm.project_id')
        .andOn('p.tenant', 'psm.tenant');
    })
    .whereNull('psm.project_status_mapping_id')
    .select('p.project_id', 'p.tenant')
    .distinct();

  console.log(`Found ${projectsWithoutStatuses.length} projects without status mappings`);

  if (projectsWithoutStatuses.length > 0) {
    // Get standard statuses for project_task
    const standardStatuses = await knex('standard_statuses')
      .where('item_type', 'project_task')
      .orderBy('display_order');

    if (standardStatuses.length === 0) {
      console.log('WARNING: No standard statuses found for project_task. Checking regular statuses table...');

      // Try the regular statuses table
      const regularStatuses = await knex('statuses')
        .where('item_type', 'project_task')
        .orderBy('order_number');

      if (regularStatuses.length === 0) {
        throw new Error('No statuses found for project_task in either standard_statuses or statuses tables');
      }

      // Create mappings using regular statuses
      const statusMappings = [];
      for (const project of projectsWithoutStatuses) {
        for (const status of regularStatuses) {
          statusMappings.push({
            tenant: project.tenant,
            project_id: project.project_id,
            status_id: status.status_id,
            custom_name: status.name,
            display_order: status.order_number || 1,
            is_visible: true,
            is_standard: false
          });
        }
      }

      // Insert in batches
      const batchSize = 1000;
      for (let i = 0; i < statusMappings.length; i += batchSize) {
        const batch = statusMappings.slice(i, i + batchSize);
        await knex('project_status_mappings').insert(batch);
      }

      console.log(`Created ${statusMappings.length} status mappings using regular statuses`);
    } else {
      // Create mappings using standard statuses
      const statusMappings = [];
      for (const project of projectsWithoutStatuses) {
        for (const status of standardStatuses) {
          statusMappings.push({
            tenant: project.tenant,
            project_id: project.project_id,
            standard_status_id: status.standard_status_id,
            custom_name: status.name,
            display_order: status.display_order,
            is_visible: true,
            is_standard: true
          });
        }
      }

      // Insert in batches
      const batchSize = 1000;
      for (let i = 0; i < statusMappings.length; i += batchSize) {
        const batch = statusMappings.slice(i, i + batchSize);
        await knex('project_status_mappings').insert(batch);
      }

      console.log(`Created ${statusMappings.length} status mappings using standard statuses`);
    }
  }

  // Step 2: Assign status mappings to tasks that don't have one
  console.log('Step 2: Checking tasks without status mappings...');

  const tasksWithoutStatus = await knex('project_tasks as pt')
    .join('project_phases as pp', function() {
      this.on('pt.phase_id', 'pp.phase_id')
        .andOn('pt.tenant', 'pp.tenant');
    })
    .whereNull('pt.project_status_mapping_id')
    .select('pt.task_id', 'pt.tenant', 'pp.project_id');

  console.log(`Found ${tasksWithoutStatus.length} tasks without status mappings`);

  if (tasksWithoutStatus.length > 0) {
    // Process tasks in batches
    const batchSize = 100;
    let updatedCount = 0;

    for (let i = 0; i < tasksWithoutStatus.length; i += batchSize) {
      const batch = tasksWithoutStatus.slice(i, i + batchSize);

      for (const task of batch) {
        // Get the first status mapping for this project
        const firstStatus = await knex('project_status_mappings')
          .where({
            project_id: task.project_id,
            tenant: task.tenant
          })
          .orderBy('display_order')
          .first();

        if (firstStatus) {
          await knex('project_tasks')
            .where({
              task_id: task.task_id,
              tenant: task.tenant
            })
            .update({
              project_status_mapping_id: firstStatus.project_status_mapping_id
            });
          updatedCount++;
        } else {
          console.log(`WARNING: No status mapping found for project ${task.project_id}`);
        }
      }
    }

    console.log(`Updated ${updatedCount} tasks with default status mappings`);
  }

  console.log('Migration completed successfully');
};

exports.down = async function(knex) {
  // We don't want to remove status mappings or task assignments in a rollback
  // as they might have been manually configured by users after the migration
  console.log('Rollback skipped: status mappings and task assignments are preserved');
};
