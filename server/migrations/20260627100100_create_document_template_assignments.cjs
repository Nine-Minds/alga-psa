/**
 * Generic document-template assignments (Approach C). Records, per (tenant, document_type, scope),
 * which template is the default — either a built-in standard (by code, resolved from the registry)
 * or a tenant custom template (by id). Scope is 'tenant' (one default per type) or 'client'
 * (a per-client override). Drives resolveDocumentTemplateAst's tenant-default / override lookups.
 */
const TABLE_NAME = 'document_template_assignments';
const TENANT_SCOPE_INDEX = 'document_template_assignments_unique_tenant_scope';
const SCOPED_SCOPE_INDEX = 'document_template_assignments_unique_scoped_entity';

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable(TABLE_NAME);

  if (!exists) {
    await knex.schema.createTable(TABLE_NAME, (table) => {
      table.uuid('assignment_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
      table.uuid('tenant').notNullable();
      table.string('document_type', 64).notNullable();
      table.string('scope_type', 32).notNullable();
      table.uuid('scope_id').nullable();
      table.string('template_source', 32).notNullable();
      table.string('standard_template_code').nullable();
      table.uuid('template_id').nullable();
      table.uuid('created_by').nullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

      table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
      table
        .foreign(['tenant', 'template_id'])
        .references(['tenant', 'template_id'])
        .inTable('document_templates')
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
      name: 'document_template_assignments_scope_type_check',
      clause: `CHECK (scope_type IN ('tenant','client'))`,
    },
    {
      name: 'document_template_assignments_template_source_check',
      clause: `CHECK (template_source IN ('standard','custom'))`,
    },
    {
      name: 'document_template_assignments_source_match_check',
      clause: `CHECK (
        (template_source = 'standard' AND standard_template_code IS NOT NULL AND template_id IS NULL)
        OR
        (template_source = 'custom' AND template_id IS NOT NULL AND standard_template_code IS NULL)
      )`,
    },
    {
      name: 'document_template_assignments_scope_id_check',
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
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
          ALTER TABLE ${TABLE_NAME} ADD CONSTRAINT ${name} ${clause};
        END IF;
      END
      $$;
    `);
  }

  // One default per (tenant, document_type) at tenant scope; one per scoped entity otherwise.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${TENANT_SCOPE_INDEX}
    ON ${TABLE_NAME} (tenant, document_type, scope_type)
    WHERE scope_id IS NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${SCOPED_SCOPE_INDEX}
    ON ${TABLE_NAME} (tenant, document_type, scope_type, scope_id)
    WHERE scope_id IS NOT NULL
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS ${TENANT_SCOPE_INDEX}`);
  await knex.raw(`DROP INDEX IF EXISTS ${SCOPED_SCOPE_INDEX}`);
  await knex.schema.dropTableIfExists(TABLE_NAME);
};
