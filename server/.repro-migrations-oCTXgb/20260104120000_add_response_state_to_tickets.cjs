/**
 * Add response_state field to tickets table
 *
 * This field tracks who needs to respond next on a ticket:
 * - 'awaiting_client': Support has responded, waiting for client
 * - 'awaiting_internal': Client has responded, waiting for support
 * - null: No response state tracking needed (new tickets, closed tickets)
 *
 * The field is automatically updated when comments are posted and
 * cleared when tickets are closed.
 *
 * NOTE: This migration modifies a distributed table (tickets) and must run
 * outside a transaction to work with Citus.
 */
exports.up = async function(knex) {
  // Create the enum type
  console.log('Creating ticket_response_state enum type...');
  await knex.raw(`
    CREATE TYPE ticket_response_state AS ENUM ('awaiting_client', 'awaiting_internal');
  `);

  // Add the column to tickets table
  console.log('Adding response_state column to tickets table...');
  await knex.schema.alterTable('tickets', (table) => {
    table.specificType('response_state', 'ticket_response_state').nullable();
  });

  // Add index for filtering queries
  // Note: Citus does not support partial indexes on distributed tables,
  // so we use a plain multi-column index instead
  console.log('Creating index on (tenant, response_state)...');
  await knex.raw(`
    CREATE INDEX idx_tickets_response_state
    ON tickets(tenant, response_state);
  `);

  console.log('Migration complete: response_state added to tickets');
};

exports.down = async function(knex) {
  // Drop the index
  console.log('Dropping index idx_tickets_response_state...');
  await knex.raw(`DROP INDEX IF EXISTS idx_tickets_response_state;`);

  // Drop the column
  console.log('Removing response_state column from tickets...');
  await knex.schema.alterTable('tickets', (table) => {
    table.dropColumn('response_state');
  });

  // Drop the enum type
  console.log('Dropping ticket_response_state enum type...');
  await knex.raw(`DROP TYPE IF EXISTS ticket_response_state;`);

  console.log('Migration rollback complete');
};

// Required for Citus: ALTER TABLE on distributed tables must run outside a transaction
exports.config = { transaction: false };
