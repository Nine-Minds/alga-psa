/**
 * Agent IdP provider presets (easy path, F001). `kind` distinguishes a Google /
 * Microsoft preset from a custom raw entry; `entra_tenant_id` stores the Entra
 * tenant for the Microsoft preset (issuer + JWKS are derived via OIDC discovery).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('agent_idp_providers', 'kind'))) {
    await knex.schema.alterTable('agent_idp_providers', (t) => {
      t.string('kind').notNullable().defaultTo('custom'); // 'google' | 'microsoft' | 'custom'
    });
  }
  if (!(await knex.schema.hasColumn('agent_idp_providers', 'entra_tenant_id'))) {
    await knex.schema.alterTable('agent_idp_providers', (t) => {
      t.string('entra_tenant_id').nullable();
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('agent_idp_providers', 'entra_tenant_id')) {
    await knex.schema.alterTable('agent_idp_providers', (t) => t.dropColumn('entra_tenant_id'));
  }
  if (await knex.schema.hasColumn('agent_idp_providers', 'kind')) {
    await knex.schema.alterTable('agent_idp_providers', (t) => t.dropColumn('kind'));
  }
};
