/**
 * Catch-up distribution for tables created without Citus coverage.
 *
 * Between the out-of-band production distribution wave (Aug–Oct 2025, the old
 * ee/server/migrations/citus scripts) and the adoption of inline
 * ensureTenantDistribution in creation migrations (Jun 2026), tenant tables were
 * created LOCAL on the coordinator. Complex query shapes joining them to
 * distributed tables fail with Citus 0A000 ("direct joins between distributed and
 * local tables are not supported") — first hit by the inventory dashboard
 * (quote_items/quotes in price-creep, ticket_materials in ghost usage) and by
 * quote/invoice tax calculations (tax child tables).
 *
 * This migration:
 *  1. Distributes the quotes family, ticket_materials and the inbound-email
 *     processing tables, colocated with `tenants`.
 *  2. Converts the tenant-less tax child tables to reference tables (port of the
 *     never-executed ee/server/migrations/citus/20260703120000; that folder is not
 *     part of the migration workflow and is being removed).
 *  3. Re-adds FKs that earlier migrations skipped or prod dropped while the
 *     referenced tables were still local (fk_sales_orders_quote from
 *     20260702140000; quote_items -> client_locations from 20260320100000).
 *
 * Everything is idempotent: already-distributed tables (production was partially
 * fixed by hand on 2026-07-08) and plain PostgreSQL are no-ops.
 */
exports.config = { transaction: false };

const { ensureTenantDistribution, canCreateDistributedTable } = require('./utils/citusDistribution.cjs');

// Referenced tables first: create_distributed_table fails when an FK points at a
// table that is still local, so targets are ensured before their referrers. The
// external targets are already distributed on production and on any smoke run
// that reached this migration — the calls are no-op guards for greenfield order.
const DISTRIBUTE_IN_ORDER = [
  // external FK targets of the family below
  'users',
  'clients',
  'contacts',
  'contracts',
  'invoices',
  'service_catalog',
  'client_locations',
  'tickets',
  // the family itself, dependency-ordered
  'quotes',
  'quote_items',
  'quote_activities',
  'quote_document_templates',
  'quote_document_template_assignments',
  'ticket_materials',
  'email_processed_messages',
  'email_processed_attachments',
];

const TAX_REFERENCE_TABLES = ['tax_rate_thresholds', 'tax_holidays', 'composite_tax_mappings'];

async function citusEnabled(knex) {
  const res = await knex.raw(`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled`);
  return Boolean(res.rows?.[0]?.enabled);
}

async function isDistributed(knex, table) {
  const res = await knex.raw(
    `SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass AND partmethod = 'h') AS ok`,
    [table]
  );
  return Boolean(res.rows?.[0]?.ok);
}

async function isReferenceTable(knex, table) {
  const res = await knex.raw(
    `SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass AND partmethod = 'n') AS ok`,
    [table]
  );
  return Boolean(res.rows?.[0]?.ok);
}

async function isInPgDistPartition(knex, table) {
  const res = await knex.raw(
    `SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass) AS present`,
    [table]
  );
  return Boolean(res.rows?.[0]?.present);
}

async function hasConstraint(knex, table, name) {
  const res = await knex.raw(
    `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ?::regclass AND conname = ?) AS ok`,
    [table, name]
  );
  return Boolean(res.rows?.[0]?.ok);
}

exports.up = async function up(knex) {
  const onCitus = await citusEnabled(knex);

  /* ---- 0. PK repair ---- */
  // quote_document_template_assignments shipped with PRIMARY KEY (assignment_id);
  // Citus requires the distribution column in every unique constraint. Rebuild as
  // (tenant, assignment_id) on all environments so schemas converge. Nothing
  // references this PK (leaf table), so the swap is safe.
  if (await knex.schema.hasTable('quote_document_template_assignments')) {
    const pk = await knex.raw(
      `SELECT array_agg(a.attname)::text[] AS cols
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.conrelid = 'quote_document_template_assignments'::regclass AND c.contype = 'p'
       GROUP BY c.oid`
    );
    const cols = pk.rows?.[0]?.cols ?? [];
    if (cols.length > 0 && !cols.includes('tenant')) {
      await knex.raw(
        `ALTER TABLE quote_document_template_assignments
           DROP CONSTRAINT quote_document_template_assignments_pkey,
           ADD CONSTRAINT quote_document_template_assignments_pkey PRIMARY KEY (tenant, assignment_id)`
      );
      console.log('  ✓ rebuilt quote_document_template_assignments PK as (tenant, assignment_id)');
    }
  }

  /* ---- 1. distribute tenant tables ---- */
  for (const table of DISTRIBUTE_IN_ORDER) {
    if (!(await knex.schema.hasTable(table))) {
      console.log(`  - ${table} does not exist, skipping`);
      continue;
    }
    await ensureTenantDistribution(knex, table);
  }

  /* ---- 2. tax child tables -> reference tables (port of dead 20260703120000) ---- */
  if (onCitus) {
    for (const table of TAX_REFERENCE_TABLES) {
      if (!(await knex.schema.hasTable(table))) {
        console.log(`  - ${table} does not exist, skipping`);
        continue;
      }
      if (await isReferenceTable(knex, table)) continue;
      if (await isInPgDistPartition(knex, table)) {
        await knex.raw(`SELECT undistribute_table('${table}')`);
      }
      // A reference table cannot hold an FK to a distributed table (tax_rates,
      // tax_components); integrity stays logical via the parent-scoped facade.
      const fks = await knex.raw(
        `SELECT conname FROM pg_constraint WHERE conrelid = ?::regclass AND contype = 'f'`,
        [table]
      );
      for (const fk of fks.rows) {
        await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${fk.conname}`);
      }
      await knex.raw(`SELECT create_reference_table('${table}')`);
      console.log(`  ✓ ${table} converted to reference table`);
    }
  }

  /* ---- 3. re-add FKs skipped while quotes/client_locations were local ---- */
  // Guarded: only when both sides are distributed (or not on Citus at all, where
  // the FKs come from the original migrations), only when missing, and orphan
  // rows downgrade to a warning instead of failing the chain.
  const reconcile = [
    {
      table: 'sales_orders',
      constraint: 'fk_sales_orders_quote',
      target: 'quotes',
      orphanSql: `SELECT EXISTS (SELECT 1 FROM sales_orders so WHERE so.quote_id IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.tenant = so.tenant AND q.quote_id = so.quote_id)) AS orphaned`,
      addSql: `ALTER TABLE sales_orders ADD CONSTRAINT fk_sales_orders_quote
                 FOREIGN KEY (tenant, quote_id) REFERENCES quotes (tenant, quote_id)`,
    },
    {
      table: 'quote_items',
      constraint: 'quote_items_location_id_tenant_foreign',
      target: 'client_locations',
      orphanSql: `SELECT EXISTS (SELECT 1 FROM quote_items qi WHERE qi.location_id IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM client_locations cl WHERE cl.tenant = qi.tenant AND cl.location_id = qi.location_id)) AS orphaned`,
      addSql: `ALTER TABLE quote_items ADD CONSTRAINT quote_items_location_id_tenant_foreign
                 FOREIGN KEY (location_id, tenant) REFERENCES client_locations (location_id, tenant) ON DELETE RESTRICT`,
    },
  ];
  for (const fk of reconcile) {
    if (!(await knex.schema.hasTable(fk.table)) || !(await knex.schema.hasTable(fk.target))) continue;
    if (await hasConstraint(knex, fk.table, fk.constraint)) continue;
    if (onCitus && (!(await isDistributed(knex, fk.table)) || !(await isDistributed(knex, fk.target)))) {
      console.warn(`  ! ${fk.constraint}: ${fk.table} or ${fk.target} not distributed, skipping`);
      continue;
    }
    const orphans = await knex.raw(fk.orphanSql);
    if (orphans.rows?.[0]?.orphaned) {
      console.warn(`  ! ${fk.constraint}: orphan rows exist, FK not added — clean up and re-add manually`);
      continue;
    }
    try {
      await knex.raw(fk.addSql);
      console.log(`  ✓ added ${fk.constraint}`);
    } catch (err) {
      console.warn(`  ! ${fk.constraint} could not be added: ${err.message}`);
    }
  }
};

exports.down = async function down(knex) {
  if (!(await citusEnabled(knex))) return;
  if (!(await canCreateDistributedTable(knex))) return;

  // Only undo what this migration itself established: the family tables and the
  // tax reference conversions. External FK targets stay distributed.
  const family = [
    'email_processed_attachments',
    'email_processed_messages',
    'ticket_materials',
    'quote_document_template_assignments',
    'quote_document_templates',
    'quote_activities',
    'quote_items',
    'quotes',
  ];
  await knex.raw('ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS fk_sales_orders_quote');
  await knex.raw('ALTER TABLE quote_items DROP CONSTRAINT IF EXISTS quote_items_location_id_tenant_foreign');
  // No cascade_via_foreign_keys: it would walk FK edges out to clients/users and
  // undistribute them too. Reverse dependency order + per-table warn instead.
  for (const table of family) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (await isInPgDistPartition(knex, table)) {
      try {
        await knex.raw(`SELECT undistribute_table('${table}')`);
      } catch (err) {
        console.warn(`  ! could not undistribute ${table}: ${err.message}`);
      }
    }
  }
  for (const table of TAX_REFERENCE_TABLES.slice().reverse()) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (await isReferenceTable(knex, table)) {
      await knex.raw(`SELECT undistribute_table('${table}')`);
    }
  }
};
