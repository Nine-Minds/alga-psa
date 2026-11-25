const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');

// alga-2026-0002932: a stage declaration cites several sources. They live in a child of
// opportunity_evidence (one row per cited interaction or document, in the order the user picked
// them); opportunity_evidence.ref_type / ref_id go back to naming the system record that produced
// a system evidence row.
//
// Constraints (PK, UNIQUE, CHECK) are declared in the CREATE TABLE, so the NOT VALID rule for
// existing tables does not apply. The table is distributed on tenant and colocated with tenants
// BEFORE the foreign keys are added (Citus only enforces an FK between colocated tables).
// create_distributed_table cannot run inside a transaction, hence transaction: false; every step
// is idempotent so a half-finished run can simply be re-run. Distribution is a no-op on plain
// Postgres.

const TABLE = 'opportunity_evidence_citations';

exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('citation_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('evidence_id').notNullable();
      table.text('ref_type').notNullable();
      // Polymorphic (interaction or document), so no foreign key: the ladder LEFT JOINs the target.
      table.uuid('ref_id').notNullable();
      table.integer('position').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'citation_id'], { constraintName: 'opportunity_evidence_citations_pkey' });
      table.unique(['tenant', 'evidence_id', 'ref_type', 'ref_id'], { indexName: 'opportunity_evidence_citations_source_unique' });
      table.check("ref_type IN ('interaction', 'document')", [], 'opportunity_evidence_citations_ref_type_check');
    });
  }
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS idx_opportunity_evidence_citations_tenant_evidence ON ${TABLE} (tenant, evidence_id)`,
  );

  await ensureTenantDistribution(knex, TABLE);

  await ensureCompositeFk(knex, {
    table: TABLE,
    constraint: 'opportunity_evidence_citations_tenant_foreign',
    columns: ['tenant'],
    referencedTable: 'tenants',
    referencedColumns: ['tenant'],
  });
  await ensureCompositeFk(knex, {
    table: TABLE,
    constraint: 'opportunity_evidence_citations_evidence_fk',
    columns: ['tenant', 'evidence_id'],
    referencedTable: 'opportunity_evidence',
    referencedColumns: ['tenant', 'evidence_id'],
    onDelete: 'CASCADE',
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};
