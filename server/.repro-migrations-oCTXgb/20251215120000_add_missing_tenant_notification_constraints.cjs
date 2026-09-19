/**
 * Add missing unique constraints to tenant notification settings tables
 * These constraints are needed for ON CONFLICT upsert operations
 */

exports.config = { transaction: false };

exports.up = async function(knex) {
  console.log('Adding missing unique constraints to tenant notification settings tables...');

  // Helper function to check if constraint exists
  const constraintExists = async (tableName, constraintName) => {
    const result = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
        AND table_name = ?
        AND constraint_name = ?
      ) AS exists;
    `, [tableName, constraintName]);
    return result.rows[0].exists;
  };

  // Add unique constraint to tenant_notification_category_settings
  const categoryConstraint = 'tenant_notification_category_settings_tenant_category_id_unique';
  if (!await constraintExists('tenant_notification_category_settings', categoryConstraint)) {
    await knex.raw(`
      ALTER TABLE tenant_notification_category_settings
      ADD CONSTRAINT ${categoryConstraint}
      UNIQUE (tenant, category_id)
    `);
    console.log(`  ✓ Added ${categoryConstraint}`);
  } else {
    console.log(`  - ${categoryConstraint} already exists`);
  }

  // Add unique constraint to tenant_notification_subtype_settings
  const subtypeConstraint = 'tenant_notification_subtype_settings_tenant_subtype_id_unique';
  if (!await constraintExists('tenant_notification_subtype_settings', subtypeConstraint)) {
    await knex.raw(`
      ALTER TABLE tenant_notification_subtype_settings
      ADD CONSTRAINT ${subtypeConstraint}
      UNIQUE (tenant, subtype_id)
    `);
    console.log(`  ✓ Added ${subtypeConstraint}`);
  } else {
    console.log(`  - ${subtypeConstraint} already exists`);
  }

  // Add unique constraint to tenant_internal_notification_category_settings
  const internalCategoryConstraint = 'tenant_internal_notification_category_settings_tenant_category_id_unique';
  if (!await constraintExists('tenant_internal_notification_category_settings', internalCategoryConstraint)) {
    await knex.raw(`
      ALTER TABLE tenant_internal_notification_category_settings
      ADD CONSTRAINT ${internalCategoryConstraint}
      UNIQUE (tenant, category_id)
    `);
    console.log(`  ✓ Added ${internalCategoryConstraint}`);
  } else {
    console.log(`  - ${internalCategoryConstraint} already exists`);
  }

  // Add unique constraint to tenant_internal_notification_subtype_settings
  const internalSubtypeConstraint = 'tenant_internal_notification_subtype_settings_tenant_subtype_id_unique';
  if (!await constraintExists('tenant_internal_notification_subtype_settings', internalSubtypeConstraint)) {
    await knex.raw(`
      ALTER TABLE tenant_internal_notification_subtype_settings
      ADD CONSTRAINT ${internalSubtypeConstraint}
      UNIQUE (tenant, subtype_id)
    `);
    console.log(`  ✓ Added ${internalSubtypeConstraint}`);
  } else {
    console.log(`  - ${internalSubtypeConstraint} already exists`);
  }

  console.log('Migration completed successfully!');
};

exports.down = async function(knex) {
  console.log('Removing unique constraints from tenant notification settings tables...');

  // Helper function to check if constraint exists
  const constraintExists = async (tableName, constraintName) => {
    const result = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
        AND table_name = ?
        AND constraint_name = ?
      ) AS exists;
    `, [tableName, constraintName]);
    return result.rows[0].exists;
  };

  const constraints = [
    { table: 'tenant_notification_category_settings', name: 'tenant_notification_category_settings_tenant_category_id_unique' },
    { table: 'tenant_notification_subtype_settings', name: 'tenant_notification_subtype_settings_tenant_subtype_id_unique' },
    { table: 'tenant_internal_notification_category_settings', name: 'tenant_internal_notification_category_settings_tenant_category_id_unique' },
    { table: 'tenant_internal_notification_subtype_settings', name: 'tenant_internal_notification_subtype_settings_tenant_subtype_id_unique' }
  ];

  for (const { table, name } of constraints) {
    if (await constraintExists(table, name)) {
      await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);
      console.log(`  ✓ Dropped ${name}`);
    }
  }

  console.log('Rollback completed successfully!');
};
