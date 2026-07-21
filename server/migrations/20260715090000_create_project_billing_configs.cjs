/**
 * Create per-project billing configuration.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */

// Composite (tenant, X) FKs must never use bare ON DELETE SET NULL: Postgres
// would null the tenant column too (see 20260611150000_fix_tenant_nulling_
// foreign_keys.cjs). PG 15+ supports column-targeted SET NULL; Citus and
// older PG fall back to NO ACTION.
const addTenantSafeSetNullFk = async (knex, { table, constraint, columns, refTable, refColumns, settable }) => {
  const versionRow = await knex.raw("SELECT current_setting('server_version_num')::int AS v");
  const { rows: citusRows } = await knex.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus' LIMIT 1");
  const clause = versionRow.rows[0].v >= 150000 && citusRows.length === 0
    ? ` ON DELETE SET NULL (${settable})`
    : '';
  await knex.raw(`
    ALTER TABLE ${table}
    ADD CONSTRAINT "${constraint}"
    FOREIGN KEY (${columns})
    REFERENCES ${refTable} (${refColumns})${clause}
  `);
};

exports.up = async function up(knex) {
  await knex.schema.createTable('project_billing_configs', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('config_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('project_id').notNullable();
    table.text('billing_model').notNullable();
    table.bigInteger('total_price').nullable();
    table.specificType('currency', 'char(3)').nullable();
    table.text('invoice_mode').notNullable().defaultTo('recurring');
    table.uuid('contract_id').nullable();
    table.bigInteger('cap_amount').nullable();
    table.text('cap_behavior').nullable();
    table.jsonb('cap_notify_thresholds').notNullable().defaultTo(knex.raw(`'[75, 90, 100]'::jsonb`));
    table.text('deposit_treatment').notNullable().defaultTo('credit');
    table.boolean('is_taxable').notNullable().defaultTo(true);
    table.text('tax_region').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'config_id']);
    table.unique(['tenant', 'project_id'], {
      indexName: 'project_billing_configs_tenant_project_unique'
    });
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'project_id'])
      .references(['tenant', 'project_id'])
      .inTable('projects')
      .onDelete('CASCADE');
  });

  await addTenantSafeSetNullFk(knex, {
    table: 'project_billing_configs',
    constraint: 'project_billing_configs_contract_fk',
    columns: 'tenant, contract_id',
    refTable: 'contracts',
    refColumns: 'tenant, contract_id',
    settable: 'contract_id',
  });

  await knex.raw(`
    ALTER TABLE project_billing_configs
    ADD CONSTRAINT project_billing_configs_billing_model_check
    CHECK (billing_model IN ('fixed_price', 'time_and_materials'))
  `);
  await knex.raw(`
    ALTER TABLE project_billing_configs
    ADD CONSTRAINT project_billing_configs_invoice_mode_check
    CHECK (invoice_mode IN ('recurring', 'standalone'))
  `);
  await knex.raw(`
    ALTER TABLE project_billing_configs
    ADD CONSTRAINT project_billing_configs_cap_behavior_check
    CHECK (cap_behavior IS NULL OR cap_behavior IN ('notify', 'hard_cap'))
  `);
  await knex.raw(`
    ALTER TABLE project_billing_configs
    ADD CONSTRAINT project_billing_configs_deposit_treatment_check
    CHECK (deposit_treatment IN ('credit', 'deduct_final'))
  `);
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('project_billing_configs');
};
