/**
 * Distribute ticket and activity-related tables
 */
exports.config = { transaction: false };

exports.up = async function(knex) {
  // Check if Citus is enabled
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);
  
  if (!citusEnabled.rows[0].enabled) {
    console.log('Citus not enabled, skipping table distribution');
    return;
  }

  console.log('Distributing ticket and activity tables...');
  
  // Helper function to safely distribute a table
  async function distributeTable(tableName, distributionColumn = 'tenant') {
    try {
      // Check if table exists
      const tableExists = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = ?
        ) as exists
      `, [tableName]);
      
      if (!tableExists.rows[0].exists) {
        console.log(`  Table ${tableName} does not exist, skipping`);
        return false;
      }

      // Check if already distributed  
      const isDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = ?::regclass
        ) as distributed
      `, [tableName]);
      
      if (isDistributed.rows[0].distributed) {
        console.log(`  Table ${tableName} already distributed, skipping`);
        return true;
      }
      
      // Distribute the table with colocation
      await knex.raw(`SELECT create_distributed_table('${tableName}', '${distributionColumn}', colocate_with => 'tenants')`);
      console.log(`  ✓ Distributed table: ${tableName}`);
      return true;
    } catch (error) {
      console.error(`  ✗ Failed to distribute table ${tableName}: ${error.message}`);
      throw error;
    }
  }

  // Status and priority tables
  await distributeTable('statuses', 'tenant');
  await distributeTable('priorities', 'tenant');
  await distributeTable('severities', 'tenant');
  await distributeTable('urgencies', 'tenant');
  await distributeTable('impacts', 'tenant');
  
  // Channel and category tables
  await distributeTable('channels', 'tenant');
  await distributeTable('categories', 'tenant');
  
  // Ticket tables
  await distributeTable('tickets', 'tenant');
  await distributeTable('ticket_resources', 'tenant');
  await distributeTable('comments', 'tenant');
  await distributeTable('vectors', 'tenant');
  
  // Interaction tables
  await distributeTable('interaction_types', 'tenant');
  await distributeTable('interactions', 'tenant');
  
  // Time tracking
  await distributeTable('time_periods', 'tenant');
  await distributeTable('time_period_types', 'tenant');
  await distributeTable('tenant_time_period_settings', 'tenant');
  await distributeTable('time_sheets', 'tenant');
  await distributeTable('time_entries', 'tenant');
  await distributeTable('time_sheet_comments', 'tenant');
  
  // Projects
  await distributeTable('projects', 'tenant');
  await distributeTable('project_phases', 'tenant');
  await distributeTable('project_tasks', 'tenant');
  await distributeTable('project_task_dependencies', 'tenant');
  await distributeTable('project_ticket_links', 'tenant');
  await distributeTable('project_status_mappings', 'tenant');
  await distributeTable('task_resources', 'tenant');
  await distributeTable('task_checklist_items', 'tenant');
  
  // Teams
  await distributeTable('teams', 'tenant');
  await distributeTable('team_members', 'tenant');
  
  // Scheduling
  await distributeTable('schedule_entries', 'tenant');
  await distributeTable('schedule_entry_assignees', 'tenant');
  await distributeTable('schedule_conflicts', 'tenant');
  
  // Jobs
  await distributeTable('jobs', 'tenant');
  await distributeTable('job_details', 'tenant');
  
  // Resources
  await distributeTable('resources', 'tenant');
  
  // Chat/messaging
  await distributeTable('chats', 'tenant');
  await distributeTable('messages', 'tenant');
  
  console.log('Ticket and activity tables distributed successfully');
};

exports.down = async function(knex) {
  // Check if Citus is enabled
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);
  
  if (!citusEnabled.rows[0].enabled) {
    return;
  }

  console.log('Undistributing ticket and activity tables...');
  
  // Helper function to safely undistribute a table
  async function undistributeTable(tableName) {
    try {
      const isDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition 
          WHERE logicalrelid = ?::regclass
        ) as distributed
      `, [tableName]);
      
      if (isDistributed.rows[0].distributed) {
        await knex.raw(`SELECT undistribute_table('${tableName}')`);
        console.log(`  ✓ Undistributed table: ${tableName}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`  ✗ Failed to undistribute table ${tableName}: ${error.message}`);
      return false;
    }
  }

  // Undistribute in reverse order
  const tables = [
    'messages',
    'chats',
    'resources',
    'job_details',
    'jobs',
    'schedule_conflicts',
    'schedule_entry_assignees',
    'schedule_entries',
    'team_members',
    'teams',
    'task_checklist_items',
    'task_resources',
    'project_status_mappings',
    'project_ticket_links',
    'project_task_dependencies',
    'project_tasks',
    'project_phases',
    'projects',
    'time_sheet_comments',
    'time_entries',
    'time_sheets',
    'tenant_time_period_settings',
    'time_period_types',
    'time_periods',
    'interactions',
    'interaction_types',
    'vectors',
    'comments',
    'ticket_resources',
    'tickets',
    'categories',
    'channels',
    'impacts',
    'urgencies',
    'severities',
    'priorities',
    'statuses'
  ];

  for (const table of tables) {
    await undistributeTable(table);
  }
};