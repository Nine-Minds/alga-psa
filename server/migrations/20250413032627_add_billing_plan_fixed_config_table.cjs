/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) { // Changed to async function
  console.log('Starting migration: add_billing_plan_fixed_config_table...');
  // Step 1: Create the table
  await knex.schema.withSchema('public').createTable('billing_plan_fixed_config', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('plan_id').notNullable();
    table.decimal('base_rate', 19, 2).nullable(); // Add base_rate for the plan's fixed price
    table.boolean('enable_proration').notNullable().defaultTo(false);
    table.string('billing_cycle_alignment', 20).notNullable().defaultTo('start'); // Match existing type/length
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'plan_id']);
    table.foreign(['tenant', 'plan_id'])
         .references(['tenant', 'plan_id'])
         .inTable('public.billing_plans')
         .onDelete('CASCADE');
  });
  console.log('Table billing_plan_fixed_config created.');

  // Step 2: Populate the newly created table (logic moved from ...32935...)
  console.log('Checking for inconsistent fixed plan service configurations...');

  // Select relevant data from plan_service_fixed_config for fixed plans, joining through plan_service_configuration
  const serviceConfigs = await knex('plan_service_fixed_config as psfc')
    .join(
      'plan_service_configuration as psc',
      function () {
        this.on('psfc.config_id', '=', 'psc.config_id').andOn(
          'psfc.tenant',
          '=',
          'psc.tenant',
        );
      },
    )
    .join('billing_plans as bp', function () {
      this.on('psc.plan_id', '=', 'bp.plan_id').andOn('psc.tenant', '=', 'bp.tenant');
    })
    .where('bp.plan_type', 'Fixed')
    .select(
      'psc.plan_id', // Select plan_id from psc
      'psfc.tenant',
      'psfc.enable_proration',
      'psfc.billing_cycle_alignment',
      'psfc.base_rate' // Select base_rate from service config for migration
    );

  // Group configurations by plan_id and tenant in memory
  const groupedConfigs = serviceConfigs.reduce(
    (acc, config) => {
      const key = `${config.tenant}::${config.plan_id}`;
      if (!acc[key]) {
        acc[key] = {
          plan_id: config.plan_id,
          tenant: config.tenant,
          configs: new Set(),
        };
      }
      acc[key].configs.add(
        JSON.stringify({
          enable_proration: config.enable_proration,
          billing_cycle_alignment: config.billing_cycle_alignment,
          base_rate: config.base_rate // Include base_rate in inconsistency check
        }),
      );
      return acc;
    },
    {},
  );

  let inconsistentCount = 0;
  // Check for inconsistencies within each group
  for (const key in groupedConfigs) {
    const group = groupedConfigs[key];
    if (group.configs.size > 1) {
      inconsistentCount++;
      console.warn(
        `INCONSISTENCY DETECTED: Contract Line (tenant: ${group.tenant}, plan_id: ${group.plan_id}) has multiple different (enable_proration, billing_cycle_alignment, base_rate) settings across its services. The first service's setting will be used for migration.`,
      );
    }
  }

  if (inconsistentCount === 0) {
    console.log('No inconsistencies found.');
  } else {
    console.log(
      `Detected ${inconsistentCount} fixed plans with inconsistent service configurations.`,
    );
  }

  console.log('Populating billing_plan_fixed_config table...');

  const insertQuery = `
    INSERT INTO billing_plan_fixed_config (plan_id, tenant, base_rate, enable_proration, billing_cycle_alignment, created_at, updated_at)
    SELECT DISTINCT ON (bp.tenant, bp.plan_id)
        bp.plan_id as plan_id,
        bp.tenant,
        psfc.base_rate, -- Select the base_rate from the first service config
        psfc.enable_proration,
        psfc.billing_cycle_alignment,
        NOW() as created_at,
        NOW() as updated_at
    FROM
        billing_plans bp
    JOIN
        plan_service_configuration psc ON bp.plan_id = psc.plan_id AND bp.tenant = psc.tenant
    JOIN
        plan_service_fixed_config psfc ON psc.config_id = psfc.config_id AND psc.tenant = psfc.tenant
    WHERE
        bp.plan_type = 'Fixed'
    ORDER BY
        bp.tenant, bp.plan_id, psfc.created_at ASC
    ON CONFLICT (tenant, plan_id) DO NOTHING;
  `;

  try {
    const result = await knex.raw(insertQuery);
    console.log(
      `Successfully populated billing_plan_fixed_config. Rows affected (may be 0 if plans already existed or no fixed plans): ${result.rowCount === null ? 'N/A (Check DB)' : result.rowCount}`,
    );
  } catch (error) {
    console.error(
      'Error populating billing_plan_fixed_config:',
      error instanceof Error ? error.message : error,
    );
    // Re-throw the error to fail the migration
    throw error;
  }

  console.log('Finished migration: add_billing_plan_fixed_config_table (including data population).');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.withSchema('public').dropTableIfExists('billing_plan_fixed_config');
};
