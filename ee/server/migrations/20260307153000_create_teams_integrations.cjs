/**
 * Create tenant-scoped Microsoft Teams integration configuration records.
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('teams_integrations');
  if (!hasTable) {
    await knex.schema.createTable('teams_integrations', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('selected_profile_id');
      table.text('install_status').notNullable().defaultTo('not_configured');
      table.jsonb('enabled_capabilities').notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
      table.jsonb('notification_categories').notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
      table.jsonb('allowed_actions').notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
      table.text('last_error');
      table.uuid('created_by');
      table.uuid('updated_by');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant']);
      table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
      table
        .foreign(['tenant', 'selected_profile_id'])
        .references(['tenant', 'profile_id'])
        .inTable('microsoft_profiles')
        .onDelete('RESTRICT');
    });
  }

  await knex.raw(`
    ALTER TABLE teams_integrations
    DROP CONSTRAINT IF EXISTS teams_integrations_install_status_check;
  `);

  await knex.raw(`
    ALTER TABLE teams_integrations
    ADD CONSTRAINT teams_integrations_install_status_check
    CHECK (install_status IN ('not_configured', 'install_pending', 'active', 'error'));
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS teams_integrations_selected_profile_idx
    ON teams_integrations (tenant, selected_profile_id);
  `);

  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = 'teams_integrations'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw("SELECT create_distributed_table('teams_integrations', 'tenant', colocate_with => 'microsoft_profiles')");
    }
  } else {
    console.warn('[create_teams_integrations] Skipping create_distributed_table (function unavailable)');
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('teams_integrations');
};

exports.config = { transaction: false };
