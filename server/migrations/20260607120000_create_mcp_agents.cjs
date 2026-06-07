/**
 * MCP agent identity (Phase 2): first-class agents bound to a tenant IdP subject,
 * trusted IdP providers per tenant, agent->role assignments, and agent-scoped
 * API keys. See docs/plans/2026-06-06-alga-mcp-server/design.md §10.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  // Tenant isolation is enforced in application code (WHERE tenant = ...), not RLS.
  if (!(await knex.schema.hasTable('agents'))) {
    await knex.schema.createTable('agents', (t) => {
      t.uuid('agent_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.string('tenant').notNullable();
      t.string('name').notNullable();
      t.string('description').nullable();
      // IdP binding: the token issuer + subject/client_id claim that identifies
      // this agent in the tenant's IdP. Nullable for non-OAuth (e.g. key-only) agents.
      t.string('idp_issuer').nullable();
      t.string('idp_subject').nullable();
      t.boolean('active').notNullable().defaultTo(true);
      t.uuid('created_by').nullable();
      t.jsonb('metadata').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index('tenant');
      // NULLs are distinct in PG unique constraints, so many key-only agents are fine.
      t.unique(['tenant', 'idp_issuer', 'idp_subject']);
    });
  }

  if (!(await knex.schema.hasTable('agent_idp_providers'))) {
    await knex.schema.createTable('agent_idp_providers', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.string('tenant').notNullable();
      t.string('issuer').notNullable();
      t.string('jwks_uri').notNullable();
      t.string('audience').nullable(); // expected token aud / resource indicator
      t.boolean('active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['tenant', 'issuer']);
      t.index('tenant');
      t.index('issuer');
    });
  }

  if (!(await knex.schema.hasTable('agent_roles'))) {
    await knex.schema.createTable('agent_roles', (t) => {
      t.uuid('agent_id').notNullable();
      t.uuid('role_id').notNullable();
      t.string('tenant').notNullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.primary(['agent_id', 'role_id']);
      t.index('tenant');
      t.index('agent_id');
    });
  }

  if (!(await knex.schema.hasColumn('api_keys', 'agent_id'))) {
    await knex.schema.alterTable('api_keys', (t) => {
      t.uuid('agent_id').nullable();
      t.index('agent_id');
    });
  }
  // Agent-scoped keys have no human user.
  await knex.raw('ALTER TABLE api_keys ALTER COLUMN user_id DROP NOT NULL');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('api_keys', 'agent_id')) {
    await knex.schema.alterTable('api_keys', (t) => {
      t.dropColumn('agent_id');
    });
  }
  // Leave api_keys.user_id nullable on down — re-adding NOT NULL could fail if
  // agent keys exist; harmless to keep nullable.
  await knex.schema.dropTableIfExists('agent_roles');
  await knex.schema.dropTableIfExists('agent_idp_providers');
  await knex.schema.dropTableIfExists('agents');
};
