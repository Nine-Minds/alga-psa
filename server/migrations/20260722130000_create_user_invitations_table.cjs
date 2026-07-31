const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

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
      // role_id has no DB FK: the standard migration chain never distributes
      // `roles` (it stays a local table on Citus), and a distributed table
      // can't FK a local one. Referential integrity is enforced in app code.
      table.uuid('role_id').nullable();
      table.text('token').notNullable();
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('used_at', { useTz: true }).nullable();
      table.jsonb('metadata').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));

      table.primary(['tenant', 'invitation_id']);

      table.index(['tenant', 'email'], 'idx_user_invitations_email');
      table.index(['tenant', 'expires_at'], 'idx_user_invitations_expires');
      table.unique(['tenant', 'token'], 'unique_user_invitation_tenant_token');
    });
  }

  // Distribute colocated with `tenants`, matching every other tenant-scoped
  // table in this codebase (colocate_with => 'users' isn't guaranteed valid
  // since `users` isn't itself distributed via create_distributed_table).
  await ensureTenantDistribution(knex, 'user_invitations');
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
