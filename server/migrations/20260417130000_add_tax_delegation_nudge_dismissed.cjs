const hasColumn = async (knex, tableName, columnName) => {
  try {
    return await knex.schema.hasColumn(tableName, columnName);
  } catch (error) {
    console.warn(`Unable to check column ${columnName} on ${tableName}:`, error);
    return false;
  }
};

exports.up = async function up(knex) {
  const tableName = 'tenant_settings';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ Skipping tax delegation nudge migration: tenant_settings table not found');
    return;
  }

  const hasDismissedAt = await hasColumn(knex, tableName, 'tax_delegation_nudge_dismissed_at');
  if (hasDismissedAt) {
    console.log('⊘ tax_delegation_nudge_dismissed_at column already exists, skipping');
    return;
  }

  await knex.schema.alterTable(tableName, (table) => {
    table.timestamp('tax_delegation_nudge_dismissed_at', { useTz: true }).nullable();
  });

  await knex.raw(`
    COMMENT ON COLUMN tenant_settings.tax_delegation_nudge_dismissed_at IS
    'Set when a tenant admin dismisses the recommendation to let the accounting system calculate tax. NULL means the banner is still visible to tenant admins.'
  `);

  console.log('✓ Added tax_delegation_nudge_dismissed_at column to tenant_settings');
};

exports.down = async function down(knex) {
  const tableName = 'tenant_settings';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ tenant_settings table not found, nothing to roll back');
    return;
  }

  const hasDismissedAt = await hasColumn(knex, tableName, 'tax_delegation_nudge_dismissed_at');
  if (!hasDismissedAt) {
    console.log('⊘ tax_delegation_nudge_dismissed_at column already absent, nothing to roll back');
    return;
  }

  await knex.schema.alterTable(tableName, (table) => {
    table.dropColumn('tax_delegation_nudge_dismissed_at');
  });

  console.log('✓ Removed tax_delegation_nudge_dismissed_at column from tenant_settings');
};

exports.config = { transaction: false };
