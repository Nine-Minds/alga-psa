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
    await knex.raw(
      `
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = %L::regclass
            AND contype = 'f'
            AND conname LIKE %L
        LOOP
          EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', %L, r.conname);
        END LOOP;
      END$$;
      `,
      [table, pattern, table]
    );
  };

  if (await tableExists('client_contracts')) {
    if (await hasColumn('client_contracts', 'template_contract_id')) {
      await dropMatchingConstraints('client_contracts', 'client_contracts_tenant_template_contract_id_foreign%');

      await knex('client_contracts')
        .whereNotNull('template_contract_id')
        .whereNotExists(
          knex('contract_templates')
            .select(1)
            .whereRaw('contract_templates.tenant = client_contracts.tenant')
            .andWhereRaw('contract_templates.template_id = client_contracts.template_contract_id')
        )
        .update({ template_contract_id: null });

      await knex.raw(`
        ALTER TABLE client_contracts
        ADD CONSTRAINT client_contracts_template_fk
        FOREIGN KEY (tenant, template_contract_id)
        REFERENCES contract_templates(tenant, template_id)
        ON DELETE SET NULL
      `);
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
        .whereNotExists(
          knex('contract_templates')
            .select(1)
            .whereRaw('contract_templates.tenant = client_contract_line_pricing.tenant')
            .andWhereRaw('contract_templates.template_id = client_contract_line_pricing.template_contract_id')
        )
        .update({ template_contract_id: null });

      await knex.raw(`
        ALTER TABLE client_contract_line_pricing
        ADD CONSTRAINT client_contract_line_pricing_template_contract_fk
        FOREIGN KEY (tenant, template_contract_id)
        REFERENCES contract_templates(tenant, template_id)
        ON DELETE SET NULL
      `);
    }

    if (await hasColumn('client_contract_line_pricing', 'template_contract_line_id')) {
      await dropMatchingConstraints(
        'client_contract_line_pricing',
        'client_contract_line_pricing_tenant_template_contract_line_id_foreign%'
      );

      await knex('client_contract_line_pricing')
        .whereNotNull('template_contract_line_id')
        .whereNotExists(
          knex('contract_template_lines')
            .select(1)
            .whereRaw('contract_template_lines.tenant = client_contract_line_pricing.tenant')
            .andWhereRaw(
              'contract_template_lines.template_line_id = client_contract_line_pricing.template_contract_line_id'
            )
        )
        .update({ template_contract_line_id: null });

      await knex.raw(`
        ALTER TABLE client_contract_line_pricing
        ADD CONSTRAINT client_contract_line_pricing_template_line_fk
        FOREIGN KEY (tenant, template_contract_line_id)
        REFERENCES contract_template_lines(tenant, template_line_id)
        ON DELETE SET NULL
      `);
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
    await knex.raw(`
      ALTER TABLE client_contracts
      ADD CONSTRAINT client_contracts_tenant_template_contract_id_foreign
      FOREIGN KEY (tenant, template_contract_id)
      REFERENCES contracts(tenant, contract_id)
      ON DELETE SET NULL
    `);
  }

  if (await tableExists('client_contract_line_pricing')) {
    await dropConstraintIfExists('client_contract_line_pricing', 'client_contract_line_pricing_template_contract_fk');
    await dropConstraintIfExists('client_contract_line_pricing', 'client_contract_line_pricing_template_line_fk');

    await knex.raw(`
      ALTER TABLE client_contract_line_pricing
      ADD CONSTRAINT client_contract_line_pricing_tenant_template_contract_id_foreign
      FOREIGN KEY (tenant, template_contract_id)
      REFERENCES contracts(tenant, contract_id)
      ON DELETE SET NULL
    `);

    await knex.raw(`
      ALTER TABLE client_contract_line_pricing
      ADD CONSTRAINT client_contract_line_pricing_tenant_template_contract_line_id_foreign
      FOREIGN KEY (tenant, template_contract_line_id)
      REFERENCES contract_lines(tenant, contract_line_id)
      ON DELETE SET NULL
    `);
  }
};
