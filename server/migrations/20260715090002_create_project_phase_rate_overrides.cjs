/**
 * Create per-phase rate and service overrides for project billing.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('project_phase_rate_overrides', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('rate_override_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('phase_id').notNullable();
    table.uuid('service_id').nullable();
    table.bigInteger('rate').nullable();
    table.uuid('override_service_id').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'rate_override_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'phase_id'])
      .references(['tenant', 'phase_id'])
      .inTable('project_phases')
      .onDelete('CASCADE');
    table.foreign(['tenant', 'service_id'])
      .references(['tenant', 'service_id'])
      .inTable('service_catalog');
    table.foreign(['tenant', 'override_service_id'])
      .references(['tenant', 'service_id'])
      .inTable('service_catalog');
  });

  await knex.raw(`
    CREATE UNIQUE INDEX project_phase_rate_overrides_tenant_phase_service_unique
    ON project_phase_rate_overrides (
      tenant,
      phase_id,
      COALESCE(service_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
  `);
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS project_phase_rate_overrides_tenant_phase_service_unique');
  await knex.schema.dropTableIfExists('project_phase_rate_overrides');
};
