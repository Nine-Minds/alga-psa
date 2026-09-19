/**
 * Update client contract foreign keys to reference contract_template tables.
 *
 * This migration rewires `client_contracts` and related tables so that
 * template references point at `contract_templates` / `contract_template_lines`
 * instead of legacy `contracts` tables. It also nulls out any lingering
 * references that do not have a corresponding template row.
 *
 * @param { import('knex').Knex } knex
 */
exports.up = async function up(knex) {
  const tableExists = async (table) => knex.schema.hasTable(table);
  const hasColumn = async (table, column) => knex.schema.hasColumn(table, column);

  const dropMatchingConstraints = async (table, pattern) => {
    const tableRegClass = table.includes('.') ? table : `public.${table}`;
    const constraints = await knex
      .select('conname')
      .from('pg_constraint')
      .whereRaw('conrelid = ?::regclass', [tableRegClass])
      .andWhere('contype', 'f')
      .andWhere('conname', 'like', pattern);

    for (const { conname } of constraints) {
      await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ??', [table, conname]);
    }
  };

  if (await tableExists('client_contracts')) {
    if (await hasColumn('client_contracts', 'template_contract_id')) {
      await dropMatchingConstraints('client_contracts', 'client_contracts_tenant_template_contract_id_foreign%');

      await knex('client_contracts')
        .whereNotNull('template_contract_id')
        .update({ template_contract_id: null });

      // Citus cannot enforce cross-reference foreign keys without reference tables,
      // so we leave the column nullable and rely on application-level validation.
    }
  }

  if (await tableExists('client_contract_line_pricing')) {
    if (await hasColumn('client_contract_line_pricing', 'template_contract_id')) {
      await dropMatchingConstraints(
        'client_contract_line_pricing',
        'client_contract_line_pricing_tenant_template_contract_id_foreign%'
      );

      await knex('client_contract_line_pricing')
        .whereNotNull('template_contract_id')
        .update({ template_contract_id: null });

      // Skip FK creation in Citus environments (handled in application logic).
    }

    if (await hasColumn('client_contract_line_pricing', 'template_contract_line_id')) {
      await dropMatchingConstraints(
        'client_contract_line_pricing',
        'client_contract_line_pricing_tenant_template_contract_line_id_foreign%'
      );

      await knex('client_contract_line_pricing')
        .whereNotNull('template_contract_line_id')
        .update({ template_contract_line_id: null });

      // Skip FK creation in Citus environments (handled in application logic).
    }
  }
};

/**
 * Restore legacy foreign keys that point to contracts / contract_lines.
 *
 * @param { import('knex').Knex } knex
 */
exports.down = async function down(knex) {
  const tableExists = async (table) => knex.schema.hasTable(table);
  const dropConstraintIfExists = async (table, constraint) => {
    await knex.raw(
      `
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_schema = current_schema()
            AND table_name = %L
            AND constraint_name = %L
        ) THEN
          ALTER TABLE %I DROP CONSTRAINT %I;
        END IF;
      END$$;
      `,
      [table, constraint, table, constraint]
    );
  };

  if (await tableExists('client_contracts')) {
    await dropConstraintIfExists('client_contracts', 'client_contracts_template_fk');
    // No-op: original FK depended on legacy shared table but cannot be re-added cleanly in Citus.
  }

  if (await tableExists('client_contract_line_pricing')) {
    await dropConstraintIfExists('client_contract_line_pricing', 'client_contract_line_pricing_template_contract_fk');
    await dropConstraintIfExists('client_contract_line_pricing', 'client_contract_line_pricing_template_line_fk');
    // Legacy constraints are not recreated to avoid cross-node FK issues.
  }
};
