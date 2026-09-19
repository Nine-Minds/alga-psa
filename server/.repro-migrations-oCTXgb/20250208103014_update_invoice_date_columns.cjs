/**
 * Update invoice date columns to use appropriate date types
 * invoice_date and due_date should be date type since they represent business days
 * created_at, updated_at, and finalized_at remain timestamptz for audit purposes
 */
exports.up = function(knex) {
  return knex.schema.alterTable('invoices', function(table) {
    // First create new columns of type date
    knex.raw('ALTER TABLE invoices ADD COLUMN invoice_date_new date');
    knex.raw('ALTER TABLE invoices ADD COLUMN due_date_new date');

    // Convert existing data
    knex.raw(`
      UPDATE invoices 
      SET invoice_date_new = invoice_date::date,
          due_date_new = due_date::date
    `);

    // Drop old columns and rename new ones
    knex.raw('ALTER TABLE invoices DROP COLUMN invoice_date');
    knex.raw('ALTER TABLE invoices DROP COLUMN due_date');
    knex.raw('ALTER TABLE invoices RENAME COLUMN invoice_date_new TO invoice_date');
    knex.raw('ALTER TABLE invoices RENAME COLUMN due_date_new TO due_date');

    // Add NOT NULL constraints back
    knex.raw('ALTER TABLE invoices ALTER COLUMN invoice_date SET NOT NULL');
    knex.raw('ALTER TABLE invoices ALTER COLUMN due_date SET NOT NULL');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('invoices', function(table) {
    // First create new columns of type timestamptz
    knex.raw('ALTER TABLE invoices ADD COLUMN invoice_date_old timestamp with time zone');
    knex.raw('ALTER TABLE invoices ADD COLUMN due_date_old timestamp with time zone');

    // Convert existing data
    knex.raw(`
      UPDATE invoices 
      SET invoice_date_old = invoice_date::timestamp with time zone,
          due_date_old = due_date::timestamp with time zone
    `);

    // Drop old columns and rename new ones
    knex.raw('ALTER TABLE invoices DROP COLUMN invoice_date');
    knex.raw('ALTER TABLE invoices DROP COLUMN due_date');
    knex.raw('ALTER TABLE invoices RENAME COLUMN invoice_date_old TO invoice_date');
    knex.raw('ALTER TABLE invoices RENAME COLUMN due_date_old TO due_date');

    // Add NOT NULL constraints back
    knex.raw('ALTER TABLE invoices ALTER COLUMN invoice_date SET NOT NULL');
    knex.raw('ALTER TABLE invoices ALTER COLUMN due_date SET NOT NULL');
  });
};
