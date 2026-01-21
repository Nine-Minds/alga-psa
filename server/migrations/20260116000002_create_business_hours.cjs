/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Create business_hours_schedules table - Reusable schedule templates
    await knex.schema.createTable('business_hours_schedules', table => {
        table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
        table.uuid('schedule_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('schedule_name').notNullable();
        table.text('timezone').notNullable().defaultTo('America/New_York');
        table.boolean('is_default').defaultTo(false);
        table.boolean('is_24x7').defaultTo(false);
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'schedule_id']);
    });

    // Create business_hours_entries table - Daily hours within a schedule
    await knex.schema.createTable('business_hours_entries', table => {
        table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
        table.uuid('entry_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('schedule_id').notNullable();
        table.integer('day_of_week').notNullable();
        table.time('start_time').notNullable();
        table.time('end_time').notNullable();
        table.boolean('is_enabled').defaultTo(true);
        table.primary(['tenant', 'entry_id']);
        table.foreign(['tenant', 'schedule_id']).references(['tenant', 'schedule_id']).inTable('business_hours_schedules');
        table.unique(['tenant', 'schedule_id', 'day_of_week']);
    });

    // Add check constraint for day_of_week (0-6)
    await knex.raw(`
        ALTER TABLE business_hours_entries
        ADD CONSTRAINT chk_day_of_week CHECK (day_of_week BETWEEN 0 AND 6)
    `);

    // Create holidays table - Holiday calendar
    await knex.schema.createTable('holidays', table => {
        table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
        table.uuid('holiday_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('schedule_id');
        table.text('holiday_name').notNullable();
        table.date('holiday_date').notNullable();
        table.boolean('is_recurring').defaultTo(false);
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.primary(['tenant', 'holiday_id']);
        table.foreign(['tenant', 'schedule_id']).references(['tenant', 'schedule_id']).inTable('business_hours_schedules');
    });

    // Add business_hours_schedule_id to sla_policies if the table exists
    const hasSlaPolicies = await knex.schema.hasTable('sla_policies');
    if (hasSlaPolicies) {
        await knex.schema.alterTable('sla_policies', table => {
            table.uuid('business_hours_schedule_id');
        });

        // Add foreign key constraint
        await knex.raw(`
            ALTER TABLE sla_policies
            ADD CONSTRAINT fk_sla_policies_business_hours_schedule
            FOREIGN KEY (tenant, business_hours_schedule_id)
            REFERENCES business_hours_schedules(tenant, schedule_id)
        `);
    }

    // Create indexes
    await knex.raw(`
        CREATE INDEX idx_business_hours_schedules_tenant ON business_hours_schedules(tenant);
        CREATE INDEX idx_business_hours_schedules_default ON business_hours_schedules(tenant, is_default) WHERE is_default = true;
        CREATE INDEX idx_business_hours_entries_schedule ON business_hours_entries(tenant, schedule_id);
        CREATE INDEX idx_holidays_tenant ON holidays(tenant);
        CREATE INDEX idx_holidays_schedule ON holidays(tenant, schedule_id);
        CREATE INDEX idx_holidays_date ON holidays(tenant, holiday_date);
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Remove foreign key and column from sla_policies if it exists
    const hasSlaPolicies = await knex.schema.hasTable('sla_policies');
    if (hasSlaPolicies) {
        const hasColumn = await knex.schema.hasColumn('sla_policies', 'business_hours_schedule_id');
        if (hasColumn) {
            await knex.raw(`
                ALTER TABLE sla_policies
                DROP CONSTRAINT IF EXISTS fk_sla_policies_business_hours_schedule
            `);
            await knex.schema.alterTable('sla_policies', table => {
                table.dropColumn('business_hours_schedule_id');
            });
        }
    }

    // Drop indexes
    await knex.raw(`
        DROP INDEX IF EXISTS idx_business_hours_schedules_tenant;
        DROP INDEX IF EXISTS idx_business_hours_schedules_default;
        DROP INDEX IF EXISTS idx_business_hours_entries_schedule;
        DROP INDEX IF EXISTS idx_holidays_tenant;
        DROP INDEX IF EXISTS idx_holidays_schedule;
        DROP INDEX IF EXISTS idx_holidays_date;
    `);

    // Drop tables in reverse order (respecting foreign key constraints)
    await knex.schema.dropTableIfExists('holidays');
    await knex.schema.dropTableIfExists('business_hours_entries');
    await knex.schema.dropTableIfExists('business_hours_schedules');
};

// Citus requires ALTER TABLE with foreign key constraints to run outside a transaction block
exports.config = { transaction: false };
