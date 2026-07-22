/**
 * Create user_invitations: email-invitation flow for internal (MSP) team
 * members, mirroring portal_invitations but targeting a not-yet-created
 * `users` row (email/first_name/last_name/role_id instead of a contact_id).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Guarded: with transaction:false a failure after this CREATE (e.g. in the
  // Citus distribution below) leaves the table behind on retry.
  if (!(await knex.schema.hasTable('user_invitations'))) {
    await knex.schema.createTable('user_invitations', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('invitation_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.text('email').notNullable();
      table.text('first_name').notNullable();
      table.text('last_name').notNullable();
      table.uuid('role_id').nullable();
      table.text('token').notNullable();
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('used_at', { useTz: true }).nullable();
      table.jsonb('metadata').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));

      table.primary(['tenant', 'invitation_id']);
      table.foreign(['tenant', 'role_id']).references(['tenant', 'role_id']).inTable('roles').onDelete('SET NULL');

      table.index(['tenant', 'email'], 'idx_user_invitations_email');
      table.index(['tenant', 'expires_at'], 'idx_user_invitations_expires');
      table.unique(['tenant', 'token'], 'unique_user_invitation_tenant_token');
    });
  }

  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'citus'
    ) AS enabled;
  `);

  if (citusEnabled.rows?.[0]?.enabled) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_dist_partition
        WHERE logicalrelid = 'user_invitations'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw("SELECT create_distributed_table('user_invitations', 'tenant', colocate_with => 'users')");
    }
  } else {
    console.warn('[create_user_invitations_table] Skipping create_distributed_table (Citus extension unavailable)');
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('user_invitations');
};

// create_distributed_table cannot run inside a transaction block.
exports.config = { transaction: false };
