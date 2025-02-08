/**
 * Migration to convert company_billing_cycles date columns to pure date type.
 * This version precomputes conversions in a staging table and adds fallback updates
 * to ensure no nulls remain before setting NOT NULL constraints.
 */
exports.up = async function (knex) {
  await knex.transaction(async (trx) => {
    // 1) Add new date columns to hold the converted values.
    await trx.schema.alterTable("company_billing_cycles", (table) => {
      table.date("effective_date_new");
      table.date("period_start_date_new");
      table.date("period_end_date_new");
    });

    // 2) Retrieve the current date once for default substitution.
    const {
      rows: [{ today }],
    } = await trx.raw(`SELECT current_date AS today`);

    // 3) Create a staging table with matching types.
    await trx.raw(`
      CREATE TABLE staging_company_billing_cycles_dates (
        billing_cycle_id uuid,
        tenant uuid,
        new_effective_date date,
        new_period_start_date date,
        new_period_end_date date
      )
    `);

    // 3a) Mark the staging table as a reference table so it's available on all workers.
    await trx.raw(`SELECT create_reference_table('staging_company_billing_cycles_dates')`);

    // 4) Populate the staging table with precomputed values.
    await trx.raw(
      `
      INSERT INTO staging_company_billing_cycles_dates
      SELECT 
          billing_cycle_id,
          tenant,
          COALESCE(effective_date::date, ?::date) AS new_effective_date,
          COALESCE(period_start_date::date, ?::date) AS new_period_start_date,
          period_end_date::date AS new_period_end_date
      FROM company_billing_cycles
      `,
      [today, today]
    );

    // 5) Update the main table by joining with the staging table.
    await trx.raw(
      `
      UPDATE company_billing_cycles c
      SET 
        effective_date_new    = s.new_effective_date,
        period_start_date_new = s.new_period_start_date,
        period_end_date_new   = s.new_period_end_date
      FROM staging_company_billing_cycles_dates s
      WHERE c.billing_cycle_id = s.billing_cycle_id
        AND c.tenant = s.tenant
      `
    );

    // 6) Fallback update: in case some rows did not get updated via the join,
    //    set any remaining NULLs in the new columns to today's date.
    await trx.raw(
      `
      UPDATE company_billing_cycles
      SET 
        effective_date_new = COALESCE(effective_date_new, ?::date),
        period_start_date_new = COALESCE(period_start_date_new, ?::date)
      WHERE effective_date_new IS NULL OR period_start_date_new IS NULL
      `,
      [today, today]
    );

    // 7) (Optional) Verify that the new columns now contain no NULL values.
    const { rows: nullChecks } = await trx.raw(
      `
      SELECT billing_cycle_id 
      FROM company_billing_cycles
      WHERE effective_date_new IS NULL OR period_start_date_new IS NULL
      LIMIT 1
      `
    );
    if (nullChecks.length > 0) {
      throw new Error("Some rows still have NULL values in the new date columns after update.");
    }

    // 8) Drop the staging table since its job is done.
    await trx.raw(`DROP TABLE staging_company_billing_cycles_dates`);

    // 9) Drop the old date columns.
    await trx.schema.alterTable("company_billing_cycles", (table) => {
      table.dropColumn("effective_date");
      table.dropColumn("period_start_date");
      table.dropColumn("period_end_date");
    });

    // 10) Rename the new columns to the original column names.
    await trx.schema.alterTable("company_billing_cycles", (table) => {
      table.renameColumn("effective_date_new", "effective_date");
      table.renameColumn("period_start_date_new", "period_start_date");
      table.renameColumn("period_end_date_new", "period_end_date");
    });

    // 11) Fallback update after renaming: ensure that if any rows are still NULL, we fill them.
    await trx.raw(
      `
      UPDATE company_billing_cycles
      SET 
        effective_date = COALESCE(effective_date, ?::date),
        period_start_date = COALESCE(period_start_date, ?::date)
      WHERE effective_date IS NULL OR period_start_date IS NULL
      `,
      [today, today]
    );

    // 12) Final verification: check that there are no NULLs.
    const { rows: finalCheck } = await trx.raw(
      `
      SELECT billing_cycle_id 
      FROM company_billing_cycles
      WHERE effective_date IS NULL OR period_start_date IS NULL
      LIMIT 1
      `
    );
    if (finalCheck.length > 0) {
      throw new Error("Final verification failed: some rows still have NULL values in effective_date or period_start_date.");
    }

    // 13) Set default values for the columns.
    await trx.raw(`
      ALTER TABLE company_billing_cycles
      ALTER COLUMN effective_date SET DEFAULT CURRENT_DATE
    `);
    await trx.raw(`
      ALTER TABLE company_billing_cycles
      ALTER COLUMN period_start_date SET DEFAULT CURRENT_DATE
    `);

    console.log('** Effective date default set to current date');
    // Get all tenants first
    const { rows: tenants } = await trx.raw(`
      SELECT DISTINCT tenant
      FROM company_billing_cycles
      WHERE effective_date IS NULL
    `);

    // Update each tenant separately
    for (const { tenant } of tenants) {
      console.log(`Updating effective_date for tenant: ${tenant}`);
      await trx.raw(`
        UPDATE company_billing_cycles
        SET effective_date = CURRENT_DATE
        WHERE effective_date IS NULL
        AND tenant = ?
      `, [tenant]);

      console.log(`Updated effective_date for tenant: ${tenant}`);
    }

    // 14) Finally, add NOT NULL constraints.
    // await trx.raw(`
    //   ALTER TABLE company_billing_cycles
    //   ALTER COLUMN effective_date SET NOT NULL
    // `);
    // await trx.raw(`
    //   ALTER TABLE company_billing_cycles
    //   ALTER COLUMN period_start_date SET NOT NULL
    // `);

    // 15) (Optional) Recreate any indexes/constraints that were dropped.
    // For example:
    await trx.raw(`
      CREATE INDEX company_billing_cycles_company_id_effective_date_index 
      ON company_billing_cycles (tenant, company_id, effective_date)
    `);
    await trx.raw(`
      CREATE UNIQUE INDEX company_billing_cycles_company_id_effective_date_unique 
      ON company_billing_cycles (tenant, company_id, effective_date)
    `);
    await trx.raw(`
      CREATE UNIQUE INDEX company_billing_cycles_no_overlap 
      ON company_billing_cycles (tenant, company_id, period_start_date, billing_cycle_id) 
      WHERE period_end_date IS NULL
    `);
    await trx.raw(`
      CREATE UNIQUE INDEX company_billing_cycles_no_overlap_finite 
      ON company_billing_cycles (tenant, company_id, period_start_date, period_end_date, billing_cycle_id) 
      WHERE period_end_date IS NOT NULL AND period_end_date > period_start_date
    `);
  });
};


////////////////////////////////////////////////////////////////////////
// Sample exports.down migration (adjust as needed)
////////////////////////////////////////////////////////////////////////
exports.down = async function (knex) {
  await knex.transaction(async (trx) => {
    // 1) Add the old timestamp columns.
    await trx.schema.alterTable("company_billing_cycles", (table) => {
      table.timestamp("effective_date_old", { useTz: true });
      table.timestamp("period_start_date_old", { useTz: true });
      table.timestamp("period_end_date_old", { useTz: true });
    });

    // 2) Bulk migrate data back using casts.
    await trx.raw(`
      UPDATE company_billing_cycles
      SET 
        effective_date_old = effective_date::timestamp with time zone,
        period_start_date_old = period_start_date::timestamp with time zone,
        period_end_date_old = period_end_date::timestamp with time zone
    `);

    // 3) Drop constraints and indexes.
    await trx.raw(`
      ALTER TABLE company_billing_cycles DROP CONSTRAINT IF EXISTS company_billing_cycles_company_id_effective_date_unique
    `);
    await trx.raw(`
      ALTER TABLE company_billing_cycles DROP CONSTRAINT IF EXISTS company_billing_cycles_no_overlap
    `);
    await trx.raw(`
      ALTER TABLE company_billing_cycles DROP CONSTRAINT IF EXISTS company_billing_cycles_no_overlap_finite
    `);
    await trx.raw(`
      DROP INDEX IF EXISTS company_billing_cycles_company_id_effective_date_index
    `);
    await trx.raw(`
      DROP INDEX IF EXISTS company_billing_cycles_no_overlap
    `);
    await trx.raw(`
      DROP INDEX IF EXISTS company_billing_cycles_no_overlap_finite
    `);

    // 4) Drop the new columns.
    await trx.schema.alterTable("company_billing_cycles", (table) => {
      table.dropColumn("effective_date");
      table.dropColumn("period_start_date");
      table.dropColumn("period_end_date");
    });

    // 5) Rename the old columns back.
    await trx.schema.alterTable("company_billing_cycles", (table) => {
      table.renameColumn("effective_date_old", "effective_date");
      table.renameColumn("period_start_date_old", "period_start_date");
      table.renameColumn("period_end_date_old", "period_end_date");
    });

    // 6) Update any NULL dates.
    await trx.raw(`
      UPDATE company_billing_cycles
      SET effective_date = CURRENT_TIMESTAMP
      WHERE effective_date IS NULL
    `);
    await trx.raw(`
      UPDATE company_billing_cycles
      SET period_start_date = CURRENT_TIMESTAMP
      WHERE period_start_date IS NULL
    `);

    // 7) Reapply defaults and NOT NULL constraints.
    await trx.raw(`
      ALTER TABLE company_billing_cycles
      ALTER COLUMN effective_date SET DEFAULT CURRENT_TIMESTAMP,
      ALTER COLUMN period_start_date SET DEFAULT CURRENT_TIMESTAMP,
      ALTER COLUMN effective_date SET NOT NULL,
      ALTER COLUMN period_start_date SET NOT NULL
    `);

    // 8) Recreate indexes.
    await trx.raw(`
      CREATE INDEX company_billing_cycles_company_id_effective_date_index 
      ON company_billing_cycles (tenant, company_id, effective_date)
    `);
    await trx.raw(`
      CREATE UNIQUE INDEX company_billing_cycles_company_id_effective_date_unique 
      ON company_billing_cycles (tenant, company_id, effective_date)
    `);
    await trx.raw(`
      CREATE UNIQUE INDEX company_billing_cycles_no_overlap 
      ON company_billing_cycles (tenant, company_id, period_start_date, billing_cycle_id) 
      WHERE period_end_date IS NULL
    `);
    await trx.raw(`
      CREATE UNIQUE INDEX company_billing_cycles_no_overlap_finite 
      ON company_billing_cycles (tenant, company_id, period_start_date, period_end_date, billing_cycle_id) 
      WHERE period_end_date IS NOT NULL AND period_end_date > period_start_date
    `);
  });
};
