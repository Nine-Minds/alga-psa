const ASSIGNMENTS_TABLE = 'invoice_template_assignments';
const TENANT_SCOPE_INDEX = 'invoice_template_assignments_unique_tenant_scope';
const SCOPED_SCOPE_INDEX = 'invoice_template_assignments_unique_scoped_entity';
const STANDARD_CODE_UNIQUE = 'standard_invoice_templates_standard_invoice_template_code_key';

exports.up = async function up(knex) {
  // Ensure standard templates can be referenced by code
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = '${STANDARD_CODE_UNIQUE}'
      ) THEN
        ALTER TABLE standard_invoice_templates
        ADD CONSTRAINT ${STANDARD_CODE_UNIQUE}
        UNIQUE (standard_invoice_template_code);
      END IF;
    END
    $$;
  `);

  const tableExists = await knex.schema.hasTable(ASSIGNMENTS_TABLE);

  if (!tableExists) {
    await knex.schema.createTable(ASSIGNMENTS_TABLE, (table) => {
      table.uuid('assignment_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
      table.uuid('tenant').notNullable();
      table.string('scope_type', 32).notNullable();
      table.uuid('scope_id').nullable();
      table.string('template_source', 32).notNullable();
      table.string('standard_invoice_template_code').nullable();
      table.uuid('invoice_template_id').nullable();
      table.uuid('created_by').nullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

      table
        .foreign('tenant')
        .references('tenant')
        .inTable('tenants')
        .onDelete('CASCADE');

      table
        .foreign(['tenant', 'invoice_template_id'])
        .references(['tenant', 'template_id'])
        .inTable('invoice_templates')
        .onDelete('SET NULL');

      table
        .foreign(['tenant', 'created_by'])
        .references(['tenant', 'user_id'])
        .inTable('users')
        .onDelete('SET NULL');

    });
  }

  const checkConstraints = [
    {
      name: 'invoice_template_assignments_scope_type_check',
      clause: `CHECK (scope_type IN ('tenant','company'))`,
    },
    {
      name: 'invoice_template_assignments_template_source_check',
      clause: `CHECK (template_source IN ('standard','custom'))`,
    },
    {
      name: 'invoice_template_assignments_source_match_check',
      clause: `CHECK (
        (template_source = 'standard' AND standard_invoice_template_code IS NOT NULL AND invoice_template_id IS NULL)
        OR
        (template_source = 'custom' AND invoice_template_id IS NOT NULL AND standard_invoice_template_code IS NULL)
      )`,
    },
    {
      name: 'invoice_template_assignments_scope_id_check',
      clause: `CHECK (
        (scope_type = 'tenant' AND scope_id IS NULL)
        OR
        (scope_type <> 'tenant' AND scope_id IS NOT NULL)
      )`,
    },
  ];

  for (const { name, clause } of checkConstraints) {
    await knex.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = '${name}'
        ) THEN
          ALTER TABLE ${ASSIGNMENTS_TABLE}
          ADD CONSTRAINT ${name} ${clause};
        END IF;
      END
      $$;
    `);
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${TENANT_SCOPE_INDEX}
    ON ${ASSIGNMENTS_TABLE} (tenant, scope_type)
    WHERE scope_id IS NULL
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${SCOPED_SCOPE_INDEX}
    ON ${ASSIGNMENTS_TABLE} (tenant, scope_type, scope_id)
    WHERE scope_id IS NOT NULL
  `);

  const clientRows = [];
  const clientsTableExists = await knex.schema.hasTable('clients');
  const clientsHasInvoiceTemplateColumn = clientsTableExists
    ? await knex.schema.hasColumn('clients', 'invoice_template_id')
    : false;

  if (clientsHasInvoiceTemplateColumn) {
    const clientDefaults = await knex('clients')
      .select('tenant', 'client_id', 'invoice_template_id')
      .whereNotNull('invoice_template_id');

    const seenClientScopes = new Set();

    for (const record of clientDefaults) {
      const scopeKey = `${record.tenant}|${record.client_id}`;
      if (seenClientScopes.has(scopeKey)) continue;
      seenClientScopes.add(scopeKey);

      clientRows.push({
        tenant: record.tenant,
        scope_type: 'company',
        scope_id: record.client_id,
        template_source: 'custom',
        invoice_template_id: record.invoice_template_id,
      });
    }
  }

  if (clientRows.length > 0) {
    await knex(ASSIGNMENTS_TABLE).insert(clientRows);
  }

  const tenantRows = [];
  const invoiceTemplatesHasIsDefault = await knex.schema.hasColumn('invoice_templates', 'is_default');

  if (invoiceTemplatesHasIsDefault) {
    const tenantDefaults = await knex('invoice_templates')
      .select('tenant', 'template_id')
      .where({ is_default: true });

    if (tenantDefaults.length > 0) {
      const seenTenants = new Set();

      for (const row of tenantDefaults) {
        if (seenTenants.has(row.tenant)) continue;
        seenTenants.add(row.tenant);

        tenantRows.push({
          tenant: row.tenant,
          scope_type: 'tenant',
          scope_id: null,
          template_source: 'custom',
          invoice_template_id: row.template_id,
        });
      }
    }
  }

  if (tenantRows.length > 0) {
    await knex(ASSIGNMENTS_TABLE).insert(tenantRows);
  }
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS ${TENANT_SCOPE_INDEX}`);
  await knex.raw(`DROP INDEX IF EXISTS ${SCOPED_SCOPE_INDEX}`);
  await knex.schema.dropTableIfExists(ASSIGNMENTS_TABLE);
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = '${STANDARD_CODE_UNIQUE}'
      ) THEN
        ALTER TABLE standard_invoice_templates
        DROP CONSTRAINT ${STANDARD_CODE_UNIQUE};
      END IF;
    END
    $$;
  `);
};
