/**
 * Inventory integrity hardening (remediation plan F024/F030/F031).
 *
 * 1) Reservation attribution: sales_order_lines gains quantity_reserved +
 *    reserved_location_id so a line's non-serialized reservation is exactly
 *    releasable and backorder math can add back the line's own reservation.
 *    (Serialized allocation stays attributed via stock_units.allocated_so_line_id;
 *    quantity_reserved remains 0 for serialized lines.)
 *
 * 2) Pre-clamp any drifted rows, then add CHECK constraints:
 *    - stock_levels: reserved_quantity/held_quantity >= 0
 *    - sales_order_lines: ordered > 0; fulfilled/invoiced/reserved >= 0;
 *      fulfilled <= ordered; invoiced <= ordered
 *    - purchase_order_lines: ordered > 0; received >= 0 (over-receipt vs ordered
 *      is ALLOWED by design — no upper bound)
 *    - stock_transfer_lines: quantity > 0
 *
 *    quantity_on_hand is deliberately NOT constrained: consume is soft-warn
 *    never-block (design decision #8), so negative on-hand is the designed
 *    signal of a physical miscount.
 */

exports.up = async function up(knex) {
  await knex.schema.alterTable('sales_order_lines', (t) => {
    t.integer('quantity_reserved').notNullable().defaultTo(0);
    t.uuid('reserved_location_id').nullable();
  });

  // --- Pre-clamp drifted data so the constraints below cannot fail. ---
  await knex.raw(`
    UPDATE stock_levels
       SET reserved_quantity = GREATEST(0, reserved_quantity),
           held_quantity     = GREATEST(0, held_quantity)
     WHERE reserved_quantity < 0 OR held_quantity < 0
  `);
  await knex.raw(`
    UPDATE sales_order_lines
       SET quantity_fulfilled = LEAST(GREATEST(0, quantity_fulfilled), quantity_ordered),
           quantity_invoiced  = LEAST(GREATEST(0, quantity_invoiced), quantity_ordered)
     WHERE quantity_fulfilled < 0 OR quantity_invoiced < 0
        OR quantity_fulfilled > quantity_ordered OR quantity_invoiced > quantity_ordered
  `);
  await knex.raw(`UPDATE purchase_order_lines SET quantity_received = 0 WHERE quantity_received < 0`);
  // Zero/negative-quantity lines are garbage the actions never produce; repair the
  // impossible ones rather than fail mid-migration.
  await knex.raw(`
    DELETE FROM sales_order_lines
     WHERE quantity_ordered <= 0 AND quantity_fulfilled <= 0 AND quantity_invoiced <= 0
  `);
  await knex.raw(`
    UPDATE sales_order_lines
       SET quantity_ordered = GREATEST(quantity_fulfilled, quantity_invoiced, 1)
     WHERE quantity_ordered <= 0
  `);
  await knex.raw(`DELETE FROM purchase_order_lines WHERE quantity_ordered <= 0 AND quantity_received <= 0`);
  await knex.raw(`
    UPDATE purchase_order_lines
       SET quantity_ordered = GREATEST(quantity_received, 1)
     WHERE quantity_ordered <= 0
  `);
  await knex.raw(`DELETE FROM stock_transfer_lines WHERE quantity <= 0`);

  // --- Constraints. ---
  await knex.raw(`
    ALTER TABLE stock_levels
      ADD CONSTRAINT chk_stock_levels_alloc_nonneg
      CHECK (reserved_quantity >= 0 AND held_quantity >= 0)
  `);
  await knex.raw(`
    ALTER TABLE sales_order_lines
      ADD CONSTRAINT chk_so_lines_quantities
      CHECK (
        quantity_ordered > 0
        AND quantity_fulfilled >= 0 AND quantity_fulfilled <= quantity_ordered
        AND quantity_invoiced >= 0 AND quantity_invoiced <= quantity_ordered
        AND quantity_reserved >= 0
      )
  `);
  await knex.raw(`
    ALTER TABLE purchase_order_lines
      ADD CONSTRAINT chk_po_lines_quantities
      CHECK (quantity_ordered > 0 AND quantity_received >= 0)
  `);
  await knex.raw(`
    ALTER TABLE stock_transfer_lines
      ADD CONSTRAINT chk_transfer_lines_quantity
      CHECK (quantity > 0)
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE stock_transfer_lines DROP CONSTRAINT IF EXISTS chk_transfer_lines_quantity`);
  await knex.raw(`ALTER TABLE purchase_order_lines DROP CONSTRAINT IF EXISTS chk_po_lines_quantities`);
  await knex.raw(`ALTER TABLE sales_order_lines DROP CONSTRAINT IF EXISTS chk_so_lines_quantities`);
  await knex.raw(`ALTER TABLE stock_levels DROP CONSTRAINT IF EXISTS chk_stock_levels_alloc_nonneg`);
  await knex.schema.alterTable('sales_order_lines', (t) => {
    t.dropColumn('quantity_reserved');
    t.dropColumn('reserved_location_id');
  });
};
