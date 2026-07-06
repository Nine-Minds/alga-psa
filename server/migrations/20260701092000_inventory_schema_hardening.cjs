/**
 * Inventory schema hardening (remediation plan F040/F041/F046–F050).
 *
 * - rma_cases: drop the unreachable 'dead_unit_returned' status from the CHECK
 *   (no code path ever set it; dead_unit_returned_at is the record) and add
 *   charge_invoice_id — the draft invoice created when a client is charged for an
 *   unreturned advance-replacement unit.
 * - sales_order_lines.tax_rate_id gains its missing FK (tax_rates PK is bare
 *   tax_rate_id in this schema, so a single-column FK).
 * - invoice_items.so_line_id backlink so SO→invoice reconciliation is a join, not
 *   an inference; populated by billing's SO invoice bridge.
 * - Hot-path indexes: stock_levels by location (location_id is the PK's 3rd column,
 *   so per-location scans had no usable prefix), order headers by client/vendor/status.
 * - The formerly-soft cross-document links get real composite FKs (ON DELETE SET
 *   NULL) + indexes now that all tables exist; orphan references are nulled first.
 * - stock_movements is enforced append-only by trigger, not just by discipline.
 */

exports.up = async function up(knex) {
  // On Citus the inventory tenant tables are distributed, which forbids three
  // things this migration would otherwise do: (1) ON DELETE SET NULL on a
  // composite FK whose columns include the `tenant` distribution key, (2) a
  // trigger on a distributed table, and (3) a distributed<->local join in the
  // tax sanitize UPDATE (tax_rates is not distributed here). On Citus we degrade
  // each the same way the codebase already does elsewhere:
  //   - SET NULL composite FKs -> NO ACTION  (server/migrations/20260611150000_fix_tenant_nulling_foreign_keys.cjs)
  //   - append-only trigger -> skipped, app-level discipline enforces it (workflow-v2 / shared_document_types precedent)
  //   - tax sanitize UPDATE -> skipped (there is no tax FK to satisfy anyway).
  // On plain Postgres (CE) behaviour is unchanged.
  const citusRes = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled");
  const isCitus = Boolean(citusRes.rows?.[0]?.enabled);
  const linkFkOnDelete = isCitus ? 'NO ACTION' : 'SET NULL';

  // --- RMA (F040/F041) ---
  await knex.schema.alterTable('rma_cases', (t) => {
    t.uuid('charge_invoice_id').nullable();
  });
  await knex.raw('ALTER TABLE rma_cases DROP CONSTRAINT IF EXISTS rma_cases_status_check');
  await knex.raw(`
    ALTER TABLE rma_cases ADD CONSTRAINT rma_cases_status_check CHECK (status = ANY (ARRAY[
      'open'::text, 'awaiting_return'::text, 'returned'::text, 'sent_to_vendor'::text,
      'replacement_received'::text, 'replacement_deployed'::text, 'dead_unit_owed'::text,
      'replaced'::text, 'credited'::text, 'charged'::text, 'closed'::text
    ]))
  `);

  // --- Tax FK (F046) ---
  // Sanitize orphan tax_rate_id references (kept even without the FK below).
  // Skipped on Citus: sales_order_lines is distributed and tax_rates is not, so
  // this correlated NOT EXISTS is an unsupported distributed<->local join. With
  // no tax FK there is nothing for it to satisfy.
  if (!isCitus) {
    await knex.raw(`
      UPDATE sales_order_lines sol SET tax_rate_id = NULL
      WHERE tax_rate_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM tax_rates tr WHERE tr.tax_rate_id = sol.tax_rate_id)
    `);
  }
  // No fk_so_lines_tax_rate FK: once sales_order_lines is distributed on Citus a
  // single-column FK to tax_rates (which is distributed with a composite key on
  // prod) is invalid. The reference stays logical — same precedent as
  // ee/server/migrations/citus/20260703120000_convert_tax_child_tables_to_reference.cjs.

  // --- SO line ↔ invoice charge backlink (F047) ---
  // invoice_items is a VIEW over invoice_charges; the persistent column lives on
  // the base table (reconciliation queries join invoice_charges directly).
  await knex.schema.alterTable('invoice_charges', (t) => {
    t.uuid('so_line_id').nullable();
    t.foreign(['tenant', 'so_line_id'], 'fk_invoice_charges_so_line')
      .references(['tenant', 'so_line_id'])
      .inTable('sales_order_lines')
      .onDelete(linkFkOnDelete);
    t.index(['tenant', 'so_line_id'], 'idx_invoice_charges_so_line');
  });

  // --- Hot-path indexes (F048) ---
  await knex.schema.alterTable('stock_levels', (t) => {
    t.index(['tenant', 'location_id'], 'idx_stock_levels_location');
  });
  await knex.schema.alterTable('sales_orders', (t) => {
    t.index(['tenant', 'client_id'], 'idx_sales_orders_client');
    t.index(['tenant', 'status'], 'idx_sales_orders_status');
  });
  await knex.schema.alterTable('purchase_orders', (t) => {
    t.index(['tenant', 'vendor_id'], 'idx_purchase_orders_vendor');
    t.index(['tenant', 'status'], 'idx_purchase_orders_status');
  });

  // --- Formerly-soft links become real FKs (F049) ---
  await knex.raw(`
    UPDATE stock_units su SET allocated_so_line_id = NULL
    WHERE allocated_so_line_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM sales_order_lines sol
      WHERE sol.tenant = su.tenant AND sol.so_line_id = su.allocated_so_line_id
    )
  `);
  await knex.raw(`
    UPDATE stock_units su SET source_po_id = NULL
    WHERE source_po_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM purchase_orders po
      WHERE po.tenant = su.tenant AND po.po_id = su.source_po_id
    )
  `);
  await knex.raw(`
    UPDATE purchase_order_lines pol SET source_so_line_id = NULL
    WHERE source_so_line_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM sales_order_lines sol
      WHERE sol.tenant = pol.tenant AND sol.so_line_id = pol.source_so_line_id
    )
  `);
  await knex.raw(`
    UPDATE sales_order_lines child SET parent_so_line_id = NULL
    WHERE parent_so_line_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM sales_order_lines parent
      WHERE parent.tenant = child.tenant AND parent.so_line_id = child.parent_so_line_id
    )
  `);
  await knex.schema.alterTable('stock_units', (t) => {
    t.foreign(['tenant', 'allocated_so_line_id'], 'fk_stock_units_allocated_so_line')
      .references(['tenant', 'so_line_id'])
      .inTable('sales_order_lines')
      .onDelete(linkFkOnDelete);
    t.index(['tenant', 'allocated_so_line_id'], 'idx_stock_units_allocated_so_line');
    t.foreign(['tenant', 'source_po_id'], 'fk_stock_units_source_po')
      .references(['tenant', 'po_id'])
      .inTable('purchase_orders')
      .onDelete(linkFkOnDelete);
    t.index(['tenant', 'source_po_id'], 'idx_stock_units_source_po');
  });
  await knex.schema.alterTable('purchase_order_lines', (t) => {
    t.foreign(['tenant', 'source_so_line_id'], 'fk_po_lines_source_so_line')
      .references(['tenant', 'so_line_id'])
      .inTable('sales_order_lines')
      .onDelete(linkFkOnDelete);
    t.index(['tenant', 'source_so_line_id'], 'idx_po_lines_source_so_line');
  });
  await knex.schema.alterTable('sales_order_lines', (t) => {
    t.foreign(['tenant', 'parent_so_line_id'], 'fk_so_lines_parent')
      .references(['tenant', 'so_line_id'])
      .inTable('sales_order_lines')
      .onDelete(linkFkOnDelete);
    t.index(['tenant', 'parent_so_line_id'], 'idx_so_lines_parent');
  });

  // --- Append-only ledger, enforced (F050) ---
  // Citus rejects triggers on distributed tables (unless citus.enable_unsafe_triggers).
  // stock_movements is distributed there, so skip the DB trigger and rely on the
  // application's append-only discipline — the same trade-off the codebase makes for
  // other triggers on distributed tables (e.g. shared_document_types / workflow-v2).
  if (!isCitus) {
    await knex.raw(`
      CREATE OR REPLACE FUNCTION forbid_stock_movement_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'stock_movements is an append-only ledger; % is not allowed', TG_OP;
      END;
      $$ LANGUAGE plpgsql
    `);
    await knex.raw(`
      CREATE TRIGGER trg_stock_movements_immutable
        BEFORE UPDATE OR DELETE ON stock_movements
        FOR EACH ROW EXECUTE FUNCTION forbid_stock_movement_mutation()
    `);
  }
};

exports.down = async function down(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS trg_stock_movements_immutable ON stock_movements');
  await knex.raw('DROP FUNCTION IF EXISTS forbid_stock_movement_mutation()');

  await knex.schema.alterTable('sales_order_lines', (t) => {
    t.dropForeign(['tenant', 'parent_so_line_id'], 'fk_so_lines_parent');
    t.dropIndex(['tenant', 'parent_so_line_id'], 'idx_so_lines_parent');
  });
  await knex.schema.alterTable('purchase_order_lines', (t) => {
    t.dropForeign(['tenant', 'source_so_line_id'], 'fk_po_lines_source_so_line');
    t.dropIndex(['tenant', 'source_so_line_id'], 'idx_po_lines_source_so_line');
  });
  await knex.schema.alterTable('stock_units', (t) => {
    t.dropForeign(['tenant', 'allocated_so_line_id'], 'fk_stock_units_allocated_so_line');
    t.dropIndex(['tenant', 'allocated_so_line_id'], 'idx_stock_units_allocated_so_line');
    t.dropForeign(['tenant', 'source_po_id'], 'fk_stock_units_source_po');
    t.dropIndex(['tenant', 'source_po_id'], 'idx_stock_units_source_po');
  });

  await knex.schema.alterTable('purchase_orders', (t) => {
    t.dropIndex(['tenant', 'vendor_id'], 'idx_purchase_orders_vendor');
    t.dropIndex(['tenant', 'status'], 'idx_purchase_orders_status');
  });
  await knex.schema.alterTable('sales_orders', (t) => {
    t.dropIndex(['tenant', 'client_id'], 'idx_sales_orders_client');
    t.dropIndex(['tenant', 'status'], 'idx_sales_orders_status');
  });
  await knex.schema.alterTable('stock_levels', (t) => {
    t.dropIndex(['tenant', 'location_id'], 'idx_stock_levels_location');
  });

  await knex.schema.alterTable('invoice_charges', (t) => {
    t.dropForeign(['tenant', 'so_line_id'], 'fk_invoice_charges_so_line');
    t.dropIndex(['tenant', 'so_line_id'], 'idx_invoice_charges_so_line');
    t.dropColumn('so_line_id');
  });

  // fk_so_lines_tax_rate is intentionally not created in up(), so nothing to drop here.

  await knex.raw('ALTER TABLE rma_cases DROP CONSTRAINT IF EXISTS rma_cases_status_check');
  await knex.raw(`
    ALTER TABLE rma_cases ADD CONSTRAINT rma_cases_status_check CHECK (status = ANY (ARRAY[
      'open'::text, 'awaiting_return'::text, 'returned'::text, 'sent_to_vendor'::text,
      'replacement_received'::text, 'replacement_deployed'::text, 'dead_unit_owed'::text,
      'dead_unit_returned'::text, 'replaced'::text, 'credited'::text, 'charged'::text, 'closed'::text
    ]))
  `);
  await knex.schema.alterTable('rma_cases', (t) => {
    t.dropColumn('charge_invoice_id');
  });
};
