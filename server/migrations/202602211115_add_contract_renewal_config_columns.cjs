const RENEWAL_MODE_CONSTRAINT = 'client_contracts_renewal_mode_check';
const NOTICE_PERIOD_CONSTRAINT = 'client_contracts_notice_period_days_check';
const RENEWAL_TERM_CONSTRAINT = 'client_contracts_renewal_term_months_check';

const ensureSequentialMode = async (knex) => {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'citus'
      ) THEN
        EXECUTE 'SET citus.multi_shard_modify_mode TO ''sequential''';
      END IF;
    END $$;
  `);
};

const hasColumn = async (knex, tableName, columnName) => {
  try {
    return await knex.schema.hasColumn(tableName, columnName);
  } catch (error) {
    console.warn(`Unable to check column ${columnName} on ${tableName}:`, error);
    return false;
  }
};

const hasConstraint = async (knex, constraintName) => {
  try {
    const result = await knex('pg_constraint')
      .select('conname')
      .where({ conname: constraintName })
      .first();
    return Boolean(result);
  } catch (error) {
    console.warn(`Unable to check constraint ${constraintName}:`, error);
    return false;
  }
};

exports.up = async function up(knex) {
  await ensureSequentialMode(knex);

  const tableName = 'client_contracts';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ Skipping renewal configuration migration: client_contracts table not found');
    return;
  }

  const [
    hasRenewalMode,
    hasNoticePeriodDays,
    hasRenewalTermMonths,
    hasUseTenantRenewalDefaults,
  ] = await Promise.all([
    hasColumn(knex, tableName, 'renewal_mode'),
    hasColumn(knex, tableName, 'notice_period_days'),
    hasColumn(knex, tableName, 'renewal_term_months'),
    hasColumn(knex, tableName, 'use_tenant_renewal_defaults'),
  ]);

  if (!hasRenewalMode || !hasNoticePeriodDays || !hasRenewalTermMonths || !hasUseTenantRenewalDefaults) {
    await knex.schema.alterTable(tableName, (table) => {
      if (!hasRenewalMode) {
        table.text('renewal_mode').notNullable().defaultTo('manual');
      }
      if (!hasNoticePeriodDays) {
        table.integer('notice_period_days').notNullable().defaultTo(30);
      }
      if (!hasRenewalTermMonths) {
        table.integer('renewal_term_months').nullable();
      }
      if (!hasUseTenantRenewalDefaults) {
        table.boolean('use_tenant_renewal_defaults').notNullable().defaultTo(true);
      }
    });
  }

  if (!(await hasConstraint(knex, RENEWAL_MODE_CONSTRAINT))) {
    await knex.raw(`
      ALTER TABLE ${tableName}
      ADD CONSTRAINT ${RENEWAL_MODE_CONSTRAINT}
      CHECK (renewal_mode IN ('none', 'manual', 'auto'));
    `);
  }

  if (!(await hasConstraint(knex, NOTICE_PERIOD_CONSTRAINT))) {
    await knex.raw(`
      ALTER TABLE ${tableName}
      ADD CONSTRAINT ${NOTICE_PERIOD_CONSTRAINT}
      CHECK (notice_period_days >= 0);
    `);
  }

  if (!(await hasConstraint(knex, RENEWAL_TERM_CONSTRAINT))) {
    await knex.raw(`
      ALTER TABLE ${tableName}
      ADD CONSTRAINT ${RENEWAL_TERM_CONSTRAINT}
      CHECK (renewal_term_months IS NULL OR renewal_term_months > 0);
    `);
  }

  console.log('✓ Added renewal configuration columns to client_contracts');
};

exports.down = async function down(knex) {
  await ensureSequentialMode(knex);

  const tableName = 'client_contracts';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ client_contracts table not found, nothing to roll back');
    return;
  }

  const [
    hasRenewalMode,
    hasNoticePeriodDays,
    hasRenewalTermMonths,
    hasUseTenantRenewalDefaults,
  ] = await Promise.all([
    hasColumn(knex, tableName, 'renewal_mode'),
    hasColumn(knex, tableName, 'notice_period_days'),
    hasColumn(knex, tableName, 'renewal_term_months'),
    hasColumn(knex, tableName, 'use_tenant_renewal_defaults'),
  ]);

  if (await hasConstraint(knex, RENEWAL_TERM_CONSTRAINT)) {
    await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT ${RENEWAL_TERM_CONSTRAINT};`);
  }
  if (await hasConstraint(knex, NOTICE_PERIOD_CONSTRAINT)) {
    await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT ${NOTICE_PERIOD_CONSTRAINT};`);
  }
  if (await hasConstraint(knex, RENEWAL_MODE_CONSTRAINT)) {
    await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT ${RENEWAL_MODE_CONSTRAINT};`);
  }

  if (!hasRenewalMode && !hasNoticePeriodDays && !hasRenewalTermMonths && !hasUseTenantRenewalDefaults) {
    console.log('⊘ Renewal configuration columns already absent, nothing to roll back');
    return;
  }

  await knex.schema.alterTable(tableName, (table) => {
    if (hasUseTenantRenewalDefaults) {
      table.dropColumn('use_tenant_renewal_defaults');
    }
    if (hasRenewalTermMonths) {
      table.dropColumn('renewal_term_months');
    }
    if (hasNoticePeriodDays) {
      table.dropColumn('notice_period_days');
    }
    if (hasRenewalMode) {
      table.dropColumn('renewal_mode');
    }
  });

  console.log('✓ Removed renewal configuration columns from client_contracts');
};

exports.config = { transaction: false };
