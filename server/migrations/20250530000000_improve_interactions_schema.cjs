/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1. Rename description column to title (preserves existing data)
  await knex.schema.alterTable('interactions', (table) => {
    table.renameColumn('description', 'title');
  });

  // 2. Add new notes column for detailed information
  await knex.schema.alterTable('interactions', (table) => {
    table.text('notes');
  });

  // 3. Add enhanced time tracking columns
  await knex.schema.alterTable('interactions', (table) => {
    table.timestamp('start_time', { useTz: true });
    table.timestamp('end_time', { useTz: true });
  });

  // 4. Update CHECK constraints to include 'interaction'
  await knex.raw(`
    ALTER TABLE standard_statuses 
    DROP CONSTRAINT IF EXISTS standard_statuses_item_type_check
  `);
  await knex.raw(`
    ALTER TABLE standard_statuses 
    ADD CONSTRAINT standard_statuses_item_type_check 
    CHECK (item_type = ANY (ARRAY['project'::text, 'project_task'::text, 'ticket'::text, 'interaction'::text]))
  `);

  await knex.raw(`
    ALTER TABLE statuses 
    DROP CONSTRAINT IF EXISTS statuses_item_type_check
  `);
  await knex.raw(`
    ALTER TABLE statuses 
    ADD CONSTRAINT statuses_item_type_check 
    CHECK (item_type = ANY (ARRAY['project'::text, 'project_task'::text, 'ticket'::text, 'interaction'::text]))
  `);

  await knex.raw(`
    ALTER TABLE statuses 
    DROP CONSTRAINT IF EXISTS statuses_status_type_check
  `);
  await knex.raw(`
    ALTER TABLE statuses 
    ADD CONSTRAINT statuses_status_type_check 
    CHECK (status_type = ANY (ARRAY['project'::text, 'ticket'::text, 'project_task'::text, 'interaction'::text]))
  `);

  // 5. Add status_id foreign key to leverage existing status system
  await knex.schema.alterTable('interactions', (table) => {
    table.uuid('status_id');
  });
// Add composite foreign key constraint
  await knex.raw(`
    ALTER TABLE interactions
    ADD CONSTRAINT interactions_status_fk
    FOREIGN KEY (tenant, status_id)
    REFERENCES statuses (tenant, status_id)
    `);

  // 6. Add standard interaction statuses
  const tenants = await knex('tenants').select('tenant');
  
  for (const tenant of tenants) {
    // First create standard statuses for this tenant
    await knex('standard_statuses').insert([
      { name: 'Planned', item_type: 'interaction', display_order: 1, tenant: tenant.tenant, is_closed: false },
      { name: 'In Progress', item_type: 'interaction', display_order: 2, tenant: tenant.tenant, is_closed: false },
      { name: 'Completed', item_type: 'interaction', display_order: 3, tenant: tenant.tenant, is_closed: true, is_default: true },
      { name: 'Cancelled', item_type: 'interaction', display_order: 4, tenant: tenant.tenant, is_closed: true }
    ]);

    // Get the standard status IDs
    const standardStatuses = await knex('standard_statuses')
      .where({ tenant: tenant.tenant, item_type: 'interaction' })
      .select('*');

    // Get a system user for this tenant
    const systemUser = await knex('users')
      .where({ tenant: tenant.tenant })
      .first();

    if (systemUser) {
      // Create tenant statuses that reference the standard ones
      for (const standardStatus of standardStatuses) {
        await knex('statuses').insert({
          tenant: tenant.tenant,
          name: standardStatus.name,
          status_type: 'interaction',
          order_number: standardStatus.display_order,
          created_by: systemUser.user_id,
          is_closed: standardStatus.is_closed,
          is_default: standardStatus.is_default || false,
          created_at: knex.fn.now()
        });
      }
    }
  }

  // 7. Set all existing interactions to 'Completed' status (backward compatibility)
  const completedStatuses = await knex('statuses')
    .where({ 
      status_type: 'interaction', 
      name: 'Completed' 
    })
    .select('tenant', 'status_id');

  for (const status of completedStatuses) {
    await knex('interactions')
      .where({ tenant: status.tenant })
      .update({ status_id: status.status_id });
  }

  // 7. Populate start_time and end_time from existing data where possible
  // Set both start_time and end_time to interaction_date (duration will be 0)
  await knex.raw(`
    UPDATE interactions 
    SET 
      start_time = interaction_date,
      end_time = interaction_date
    WHERE interaction_date IS NOT NULL
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Remove the composite foreign key constraint first
  await knex.raw(`
    ALTER TABLE interactions
    DROP CONSTRAINT IF EXISTS interactions_status_fk
  `);

  // Remove the new columns
  await knex.schema.alterTable('interactions', (table) => {
    table.dropColumn('status_id');
    table.dropColumn('start_time');
    table.dropColumn('end_time');
    table.dropColumn('notes');
  });

  // Rename title back to description
  await knex.schema.alterTable('interactions', (table) => {
    table.renameColumn('title', 'description');
  });

  // Remove interaction statuses
  await knex('statuses')
    .where({ status_type: 'interaction' })
    .delete();

  // Remove standard interaction statuses
  await knex('standard_statuses')
    .where({ item_type: 'interaction' })
    .delete();

  // Restore original CHECK constraints
  await knex.raw(`
    ALTER TABLE standard_statuses 
    DROP CONSTRAINT IF EXISTS standard_statuses_item_type_check
  `);
  await knex.raw(`
    ALTER TABLE standard_statuses 
    ADD CONSTRAINT standard_statuses_item_type_check 
    CHECK (item_type = ANY (ARRAY['project'::text, 'project_task'::text, 'ticket'::text]))
  `);

  await knex.raw(`
    ALTER TABLE statuses 
    DROP CONSTRAINT IF EXISTS statuses_item_type_check
  `);
  await knex.raw(`
    ALTER TABLE statuses 
    ADD CONSTRAINT statuses_item_type_check 
    CHECK (item_type = ANY (ARRAY['project'::text, 'project_task'::text, 'ticket'::text]))
  `);

  await knex.raw(`
    ALTER TABLE statuses 
    DROP CONSTRAINT IF EXISTS statuses_status_type_check
  `);
  await knex.raw(`
    ALTER TABLE statuses 
    ADD CONSTRAINT statuses_status_type_check 
    CHECK (status_type = ANY (ARRAY['project'::text, 'ticket'::text, 'project_task'::text]))
  `);
};
