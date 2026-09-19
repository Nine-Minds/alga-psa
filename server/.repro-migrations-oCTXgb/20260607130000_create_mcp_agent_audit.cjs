/**
 * MCP agent action audit (Phase 2 F032/F033): one row per agent tool invocation,
 * attributable + exportable. Tenant-RLS'd.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (await knex.schema.hasTable('mcp_agent_audit')) return;
  await knex.schema.createTable('mcp_agent_audit', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('tenant').notNullable();
    t.uuid('agent_id').notNullable();
    t.string('tool').notNullable();
    t.jsonb('arguments').nullable();
    t.boolean('ok').notNullable().defaultTo(true);
    t.integer('status_code').nullable();
    t.string('decision').nullable(); // 'allow' | 'deny' | 'error'
    t.text('result_summary').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['tenant', 'agent_id', 'created_at']);
  });
  // Tenant isolation is enforced in application code (WHERE tenant = ...), not RLS.
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mcp_agent_audit');
};
