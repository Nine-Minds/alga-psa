/**
 * Remove ON DELETE SET NULL foreign keys that are incompatible with Citus distribution.
 *
 * These FKs are problematic because:
 * 1. ON DELETE SET NULL on composite keys tries to set ALL columns to NULL
 * 2. The tenant column has a NOT NULL constraint
 * 3. Citus doesn't support certain FK constraints on distributed tables
 *
 * The deletion logic is now handled in application code.
 */

const FK_CONSTRAINTS = [
  {
    table: 'client_contract_lines',
    constraint: 'client_contract_lines_client_contract_fk',
    references: 'client_contracts(tenant, client_contract_id)',
    columns: '(tenant, client_contract_id)',
  },
  {
    table: 'time_entries',
    constraint: 'time_entries_client_contract_line_fk',
    references: 'client_contract_lines(tenant, client_contract_line_id)',
    columns: '(tenant, contract_line_id)',
  },
];

async function dropConstraintIfExists(knex, table, constraint) {
  const exists = await knex.raw(`
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = ?
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = ?
    AND table_schema = current_schema()
  `, [table, constraint]);

  if (exists.rows.length > 0) {
    await knex.raw(`ALTER TABLE ?? DROP CONSTRAINT ??`, [table, constraint]);
    console.log(`  ✓ Dropped ${constraint}`);
    return true;
  }
  console.log(`  ⚠ Constraint ${constraint} does not exist, skipping`);
  return false;
}

exports.up = async function up(knex) {
  console.log('Removing ON DELETE SET NULL foreign keys (incompatible with Citus)...');

  for (const fk of FK_CONSTRAINTS) {
    await dropConstraintIfExists(knex, fk.table, fk.constraint);
  }
};

exports.down = async function down(knex) {
  // Re-add the FK constraints (not recommended for Citus environments)
  console.log('Re-adding ON DELETE SET NULL foreign keys...');

  for (const fk of FK_CONSTRAINTS) {
    const exists = await knex.raw(`
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = ?
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name = ?
      AND table_schema = current_schema()
    `, [fk.table, fk.constraint]);

    if (exists.rows.length === 0) {
      try {
        await knex.raw(`
          ALTER TABLE ??
          ADD CONSTRAINT ??
          FOREIGN KEY ${fk.columns}
          REFERENCES ${fk.references}
          ON DELETE SET NULL
        `, [fk.table, fk.constraint]);
        console.log(`  ✓ Added ${fk.constraint}`);
      } catch (error) {
        console.log(`  ⚠ Could not add ${fk.constraint}: ${error.message}`);
      }
    }
  }
};
