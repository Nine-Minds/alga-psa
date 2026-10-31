/**
 * A trusted agent IdP with no expected audience cannot be trusted: token
 * validation now refuses it (see ee/server/src/lib/mcp/idpToken.ts). Deactivate
 * legacy rows whose audience is NULL or blank so they are inert and visible for
 * repair. Rows are kept; no constraint is added (the invariant lives where
 * trust is decided, in application code).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('agent_idp_providers'))) return;
  await knex('agent_idp_providers')
    .where({ active: true })
    .where((q) => q.whereNull('audience').orWhereRaw("btrim(audience) = ''"))
    .update({ active: false, updated_at: knex.fn.now() });
};

/**
 * No-op: re-activating would restore fail-open trust, and we cannot tell which
 * rows this migration deactivated versus an operator.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down() {};
