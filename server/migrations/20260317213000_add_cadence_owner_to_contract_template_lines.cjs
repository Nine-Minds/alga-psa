exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('contract_template_lines');
  if (!hasTable) {
    return;
  }

  const hasCadenceOwnerColumn = await knex.schema.hasColumn('contract_template_lines', 'cadence_owner');
  if (!hasCadenceOwnerColumn) {
    await knex.schema.alterTable('contract_template_lines', (table) => {
      table.string('cadence_owner', 16).notNullable().defaultTo('client');
    });
  }

  await knex.raw(`
    UPDATE contract_template_lines AS ctl
    SET cadence_owner = COALESCE(cl.cadence_owner, 'client')
    FROM contract_lines AS cl
    WHERE cl.tenant = ctl.tenant
      AND cl.contract_line_id = ctl.template_line_id
  `);

  await knex('contract_template_lines')
    .whereNull('cadence_owner')
    .update({ cadence_owner: 'client' });

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'contract_template_lines_cadence_owner_check'
      ) THEN
        ALTER TABLE contract_template_lines
        ADD CONSTRAINT contract_template_lines_cadence_owner_check
        CHECK (cadence_owner IN ('client', 'contract'));
      END IF;
    END
    $$;
  `);
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('contract_template_lines');
  if (!hasTable) {
    return;
  }

  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'contract_template_lines_cadence_owner_check'
      ) THEN
        ALTER TABLE contract_template_lines
        DROP CONSTRAINT contract_template_lines_cadence_owner_check;
      END IF;
    END
    $$;
  `);

  const hasCadenceOwnerColumn = await knex.schema.hasColumn('contract_template_lines', 'cadence_owner');
  if (hasCadenceOwnerColumn) {
    await knex.schema.alterTable('contract_template_lines', (table) => {
      table.dropColumn('cadence_owner');
    });
  }
};
