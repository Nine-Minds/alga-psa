exports.config = { transaction: false };

async function getForeignKeys(knex, tableName) {
  const result = await knex.raw(
    `
      WITH fk_details AS (
        SELECT
          c.conname AS constraint_name,
          rf.relname AS foreign_table_name,
          a.attname AS column_name,
          af.attname AS foreign_column_name,
          cols.idx AS position
        FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_class rf ON rf.oid = c.confrelid
        CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS cols(local_col, foreign_col, idx)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = cols.local_col
        JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = cols.foreign_col
        WHERE c.contype = 'f'
          AND r.relname = ?
      )
      SELECT
        constraint_name,
        foreign_table_name,
        array_agg(column_name ORDER BY position) AS columns,
        array_agg(foreign_column_name ORDER BY position) AS foreign_columns
      FROM fk_details
      GROUP BY constraint_name, foreign_table_name
    `,
    [tableName]
  );

  return result.rows;
}

async function ensureCompositeForeignKey(knex, {
  tableName,
  foreignTableName,
  requiredColumns,
  requiredForeignColumns,
  constraintName,
  onDelete
}) {
  const foreignKeys = await getForeignKeys(knex, tableName);
  const requiredColumnsKey = requiredColumns.join(',');
  const requiredForeignColumnsKey = requiredForeignColumns.join(',');

  const exactMatch = foreignKeys.find((fk) =>
    fk.foreign_table_name === foreignTableName &&
    fk.columns.join(',') === requiredColumnsKey &&
    fk.foreign_columns.join(',') === requiredForeignColumnsKey
  );

  if (exactMatch) {
    console.log(`  ${tableName}: ${exactMatch.constraint_name} already uses ${requiredColumnsKey}`);
    return;
  }

  const conflictingKeys = foreignKeys.filter((fk) =>
    fk.foreign_table_name === foreignTableName &&
    fk.columns.some((column) => requiredColumns.includes(column))
  );

  for (const fk of conflictingKeys) {
    await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${fk.constraint_name}`);
    console.log(`  ${tableName}: dropped conflicting constraint ${fk.constraint_name}`);
  }

  await knex.raw(`
    ALTER TABLE ${tableName}
    ADD CONSTRAINT ${constraintName}
    FOREIGN KEY (${requiredColumns.join(', ')})
    REFERENCES ${foreignTableName}(${requiredForeignColumns.join(', ')})
    ON DELETE ${onDelete}
  `);
  console.log(`  ${tableName}: added ${constraintName}`);
}

exports.up = async function(knex) {
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);

  if (!citusEnabled.rows[0].enabled) {
    console.log('Citus not enabled, skipping phase status FK repair');
    return;
  }

  if (await knex.schema.hasTable('project_status_mappings')) {
    await ensureCompositeForeignKey(knex, {
      tableName: 'project_status_mappings',
      foreignTableName: 'project_phases',
      requiredColumns: ['tenant', 'phase_id'],
      requiredForeignColumns: ['tenant', 'phase_id'],
      constraintName: 'project_status_mappings_tenant_phase_id_foreign',
      onDelete: 'CASCADE'
    });
  }

  if (await knex.schema.hasTable('project_template_status_mappings')) {
    await ensureCompositeForeignKey(knex, {
      tableName: 'project_template_status_mappings',
      foreignTableName: 'project_template_phases',
      requiredColumns: ['tenant', 'template_phase_id'],
      requiredForeignColumns: ['tenant', 'template_phase_id'],
      constraintName: 'project_template_status_mappings_tenant_template_phase_id_foreign',
      onDelete: 'CASCADE'
    });
  }
};

exports.down = async function(knex) {
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);

  if (!citusEnabled.rows[0].enabled) {
    return;
  }

  await knex.raw(`
    ALTER TABLE project_status_mappings
    DROP CONSTRAINT IF EXISTS project_status_mappings_tenant_phase_id_foreign
  `);

  await knex.raw(`
    ALTER TABLE project_template_status_mappings
    DROP CONSTRAINT IF EXISTS project_template_status_mappings_tenant_template_phase_id_foreign
  `);
};
