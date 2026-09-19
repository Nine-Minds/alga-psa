const TABLE = 'recurring_service_periods';

const CHECK_CONSTRAINTS = {
  cadenceOwner: `${TABLE}_cadence_owner_check`,
  duePosition: `${TABLE}_due_position_check`,
  lifecycleState: `${TABLE}_lifecycle_state_check`,
  obligationType: `${TABLE}_obligation_type_check`,
  chargeFamily: `${TABLE}_charge_family_check`,
  provenanceKind: `${TABLE}_provenance_kind_check`,
  revision: `${TABLE}_revision_check`,
  servicePeriod: `${TABLE}_service_period_range_check`,
  invoiceWindow: `${TABLE}_invoice_window_range_check`,
  activityWindow: `${TABLE}_activity_window_check`,
  supersedes: `${TABLE}_supersedes_record_check`,
};

/**
 * Create the first persisted recurring service-period ledger table.
 * F231 defined the logical contract; this migration lands the physical shape,
 * integrity constraints, and lookup indexes that later materialization/runtime
 * passes will consume.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable(TABLE);
  if (!hasTable) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('record_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable();
      table.string('schedule_key', 255).notNullable();
      table.string('period_key', 255).notNullable();
      table.integer('revision').notNullable().defaultTo(1);
      table.uuid('obligation_id').notNullable();
      table.string('obligation_type', 40).notNullable();
      table.string('charge_family', 20).notNullable();
      table.string('cadence_owner', 16).notNullable();
      table.string('due_position', 16).notNullable();
      table.string('lifecycle_state', 20).notNullable().defaultTo('generated');
      table.date('service_period_start').notNullable();
      table.date('service_period_end').notNullable();
      table.date('invoice_window_start').notNullable();
      table.date('invoice_window_end').notNullable();
      table.date('activity_window_start').nullable();
      table.date('activity_window_end').nullable();
      table.jsonb('timing_metadata').nullable();
      table.string('provenance_kind', 20).notNullable();
      table.string('source_rule_version', 255).notNullable();
      table.string('reason_code', 100).nullable();
      table.string('source_run_key', 255).nullable();
      table.uuid('supersedes_record_id').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'record_id']);
      table.unique(
        ['tenant', 'schedule_key', 'period_key', 'revision'],
        `${TABLE}_tenant_schedule_period_revision_uidx`,
      );
      table.index(
        ['tenant', 'schedule_key', 'service_period_start'],
        `${TABLE}_tenant_schedule_start_idx`,
      );
      table.index(
        ['tenant', 'obligation_id', 'lifecycle_state'],
        `${TABLE}_tenant_obligation_state_idx`,
      );
      table.index(
        ['tenant', 'lifecycle_state', 'invoice_window_start', 'invoice_window_end'],
        `${TABLE}_tenant_due_selection_idx`,
      );
    });

    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${CHECK_CONSTRAINTS.cadenceOwner}
      CHECK (cadence_owner IN ('client', 'contract'))
    `);
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${CHECK_CONSTRAINTS.duePosition}
      CHECK (due_position IN ('advance', 'arrears'))
    `);
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${CHECK_CONSTRAINTS.lifecycleState}
      CHECK (lifecycle_state IN ('generated', 'edited', 'skipped', 'locked', 'billed', 'superseded', 'archived'))
    `);
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${CHECK_CONSTRAINTS.obligationType}
      CHECK (obligation_type IN ('contract_line', 'client_contract_line', 'template_line', 'preset_line'))
    `);
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${CHECK_CONSTRAINTS.chargeFamily}
      CHECK (charge_family IN ('fixed', 'product', 'license', 'bucket', 'hourly', 'usage'))
    `);
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${CHECK_CONSTRAINTS.provenanceKind}
      CHECK (provenance_kind IN ('generated', 'user_edited', 'regenerated', 'repair'))
    `);
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${CHECK_CONSTRAINTS.revision}
      CHECK (revision >= 1)
    `);
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${CHECK_CONSTRAINTS.servicePeriod}
      CHECK (service_period_start < service_period_end)
    `);
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${CHECK_CONSTRAINTS.invoiceWindow}
      CHECK (invoice_window_start < invoice_window_end)
    `);
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${CHECK_CONSTRAINTS.activityWindow}
      CHECK (
        (activity_window_start IS NULL AND activity_window_end IS NULL)
        OR (
          activity_window_start IS NOT NULL
          AND activity_window_end IS NOT NULL
          AND activity_window_start < activity_window_end
          AND activity_window_start >= service_period_start
          AND activity_window_end <= service_period_end
        )
      )
    `);
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${CHECK_CONSTRAINTS.supersedes}
      CHECK (supersedes_record_id IS NULL OR supersedes_record_id <> record_id)
    `);
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  for (const constraint of Object.values(CHECK_CONSTRAINTS)) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${constraint}`);
  }

  await knex.schema.dropTableIfExists(TABLE);
};
