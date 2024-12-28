exports.up = async function(knex) {
  await knex.transaction(async (trx) => {
    // Copy existing user_id values to schedule_entry_assignees if not already there
    await trx.raw(`
      INSERT INTO schedule_entry_assignees (tenant, entry_id, user_id)
      SELECT tenant, entry_id, user_id 
      FROM schedule_entries
      WHERE NOT EXISTS (
        SELECT 1 FROM schedule_entry_assignees 
        WHERE schedule_entry_assignees.tenant = schedule_entries.tenant
        AND schedule_entry_assignees.entry_id = schedule_entries.entry_id
        AND schedule_entry_assignees.user_id = schedule_entries.user_id
      )
    `);

    // Drop the foreign key constraint
    await trx.raw(`
      ALTER TABLE schedule_entries 
      DROP CONSTRAINT schedule_entries_tenant_user_id_foreign
    `);

    // Drop the user_id column
    await trx.raw(`
      ALTER TABLE schedule_entries 
      DROP COLUMN user_id
    `);
  });
};

exports.down = async function(knex) {
  await knex.transaction(async (trx) => {
    // Add back the user_id column
    await trx.raw(`
      ALTER TABLE schedule_entries 
      ADD COLUMN user_id uuid
    `);

    // Set user_id from schedule_entry_assignees
    await trx.raw(`
      UPDATE schedule_entries SET user_id = (
        SELECT user_id FROM schedule_entry_assignees 
        WHERE schedule_entry_assignees.entry_id = schedule_entries.entry_id 
        AND schedule_entry_assignees.tenant = schedule_entries.tenant 
        LIMIT 1
      )
    `);

    // Make user_id not nullable
    await trx.raw(`
      ALTER TABLE schedule_entries 
      ALTER COLUMN user_id SET NOT NULL
    `);

    // Add back the foreign key constraint
    await trx.raw(`
      ALTER TABLE schedule_entries 
      ADD CONSTRAINT schedule_entries_tenant_user_id_foreign 
      FOREIGN KEY (tenant, user_id) 
      REFERENCES users(tenant, user_id)
    `);
  });
};
