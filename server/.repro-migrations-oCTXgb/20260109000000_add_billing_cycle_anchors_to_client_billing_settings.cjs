/**
 * Add billing cycle anchor configuration to client_billing_settings.
 *
 * Anchors are optional per-client settings that influence future billing cycle generation.
 * Date semantics in billing cycles are [start, end) (end exclusive); anchors define the
 * boundary starts for weekly/bi-weekly/monthly+/annual schedules.
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('client_billing_settings');
  if (!hasTable) {
    // Nothing to do; environments that don't have this table yet will get it via
    // earlier migrations.
    return;
  }

  await knex.schema.alterTable('client_billing_settings', (table) => {
    table.integer('billing_cycle_anchor_day_of_month').nullable();
    table.integer('billing_cycle_anchor_month_of_year').nullable();
    table.integer('billing_cycle_anchor_day_of_week').nullable();
    table.timestamp('billing_cycle_anchor_reference_date').nullable();
  });

  // Add lightweight DB-level validation for new rows/updates.
  // IMPORTANT: migrations run in a transaction; catching JS errors doesn't reset a failed PG transaction.
  // Use conditional DDL to avoid aborting the transaction if constraints already exist.
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'client_billing_settings_anchor_day_of_month_range'
      ) THEN
        ALTER TABLE client_billing_settings
          ADD CONSTRAINT client_billing_settings_anchor_day_of_month_range
            CHECK (
              billing_cycle_anchor_day_of_month IS NULL OR
              (billing_cycle_anchor_day_of_month >= 1 AND billing_cycle_anchor_day_of_month <= 28)
            );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'client_billing_settings_anchor_month_of_year_range'
      ) THEN
        ALTER TABLE client_billing_settings
          ADD CONSTRAINT client_billing_settings_anchor_month_of_year_range
            CHECK (
              billing_cycle_anchor_month_of_year IS NULL OR
              (billing_cycle_anchor_month_of_year >= 1 AND billing_cycle_anchor_month_of_year <= 12)
            );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'client_billing_settings_anchor_day_of_week_range'
      ) THEN
        ALTER TABLE client_billing_settings
          ADD CONSTRAINT client_billing_settings_anchor_day_of_week_range
            CHECK (
              billing_cycle_anchor_day_of_week IS NULL OR
              (billing_cycle_anchor_day_of_week >= 1 AND billing_cycle_anchor_day_of_week <= 7)
            );
      END IF;
    END $$;
  `);

  // Backfill defaults for monthly+ so behavior stays calendar-aligned by default.
  // Weekly/bi-weekly remain "rolling" unless explicitly anchored by an admin.
  await knex.raw(`
    UPDATE client_billing_settings cbs
    SET billing_cycle_anchor_day_of_month = CASE
          WHEN cbs.billing_cycle_anchor_day_of_month IS NULL THEN 1
          WHEN cbs.billing_cycle_anchor_day_of_month < 1 THEN 1
          WHEN cbs.billing_cycle_anchor_day_of_month > 28 THEN 28
          ELSE cbs.billing_cycle_anchor_day_of_month
        END,
        billing_cycle_anchor_month_of_year = CASE
          WHEN c.billing_cycle IN ('quarterly', 'semi-annually', 'annually') THEN
            CASE
              WHEN cbs.billing_cycle_anchor_month_of_year IS NULL THEN 1
              WHEN cbs.billing_cycle_anchor_month_of_year < 1 THEN 1
              WHEN cbs.billing_cycle_anchor_month_of_year > 12 THEN 12
              ELSE cbs.billing_cycle_anchor_month_of_year
            END
          ELSE NULL
        END,
        billing_cycle_anchor_day_of_week = NULL,
        billing_cycle_anchor_reference_date = NULL,
        updated_at = NOW()
    FROM clients c
    WHERE c.tenant = cbs.tenant
      AND c.client_id = cbs.client_id
      AND c.billing_cycle IN ('monthly', 'quarterly', 'semi-annually', 'annually')
  `);
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('client_billing_settings');
  if (!hasTable) {
    return;
  }

  // Drop constraints if present.
  await knex.raw(`
    ALTER TABLE client_billing_settings
      DROP CONSTRAINT IF EXISTS client_billing_settings_anchor_day_of_month_range,
      DROP CONSTRAINT IF EXISTS client_billing_settings_anchor_month_of_year_range,
      DROP CONSTRAINT IF EXISTS client_billing_settings_anchor_day_of_week_range
  `);

  await knex.schema.alterTable('client_billing_settings', (table) => {
    table.dropColumn('billing_cycle_anchor_reference_date');
    table.dropColumn('billing_cycle_anchor_day_of_week');
    table.dropColumn('billing_cycle_anchor_month_of_year');
    table.dropColumn('billing_cycle_anchor_day_of_month');
  });
};
