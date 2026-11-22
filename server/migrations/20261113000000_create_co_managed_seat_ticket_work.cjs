/**
 * Co-managed seat and workspace shapes on one seat pool, slice S23 (F054).
 *
 * Who is responsible for a ticket of a client in a seat arrangement, in the SPONSOR (MSP) tenant:
 *
 * - `co_managed_seat_ticket_work`: one ticket's responsibility, `client_it` or `msp`, and the
 *   revision a handoff must name. A ticket with no row is the MSP's at revision 0, so existing
 *   and MSP-created tickets need no row and nothing is backfilled.
 * - `co_managed_seat_ticket_handoffs`: one handoff receipt, keyed by its operation id. Append-only:
 *   a replay of the operation returns this row.
 *
 * Like the seat arrangement tables (20261112100000): every key leads with `tenant` (the Citus
 * distribution column), there are no foreign keys and no triggers, and invariants live in
 * CHECKs, unique indexes and the commands that write the rows. Additive only: nothing reads or
 * writes these tables until the handoff commands are called.
 *
 * Idempotent; safe to re-run over an already migrated database.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLES = ['co_managed_seat_ticket_work', 'co_managed_seat_ticket_handoffs'];
const RESPONSIBILITIES = "('client_it', 'msp')";

/** @param { import("knex").Knex } knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('co_managed_seat_ticket_work'))) {
    await knex.schema.createTable('co_managed_seat_ticket_work', (table) => {
      table.uuid('tenant').notNullable(); // Sponsoring MSP.
      table.uuid('ticket_id').notNullable();
      table.uuid('arrangement_id').notNullable(); // The arrangement the last transition ran under.
      table.text('responsibility').notNullable();
      table.integer('revision').notNullable();
      table.timestamp('last_transition_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'ticket_id']);
      table.check(`responsibility IN ${RESPONSIBILITIES}`);
      table.check('revision > 0');
    });
  }
  await knex.raw(`CREATE INDEX IF NOT EXISTS co_managed_seat_ticket_work_arrangement_index
    ON co_managed_seat_ticket_work (tenant, arrangement_id, responsibility)`);

  if (!(await knex.schema.hasTable('co_managed_seat_ticket_handoffs'))) {
    await knex.schema.createTable('co_managed_seat_ticket_handoffs', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('operation_id').notNullable();
      table.uuid('ticket_id').notNullable();
      table.uuid('arrangement_id').notNullable();
      table.integer('revision').notNullable(); // The work revision this handoff produced.
      table.text('from_responsibility').notNullable();
      table.text('to_responsibility').notNullable();
      table.text('request_fingerprint').notNullable();
      table.text('note').notNullable(); // The shared note: MSP staff and the client's technicians.
      table.uuid('actor_user_id').notNullable();
      table.uuid('assigned_to').nullable(); // Who the handoff left the ticket assigned to, if anyone.
      table.timestamp('occurred_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'operation_id']);
      // One receipt per revision of a ticket: two handoffs cannot both win the same revision.
      table.unique(['tenant', 'ticket_id', 'revision']);
      table.check(`from_responsibility IN ${RESPONSIBILITIES}`);
      table.check(`to_responsibility IN ${RESPONSIBILITIES}`);
      table.check('from_responsibility <> to_responsibility');
      table.check('revision > 0');
      table.check("btrim(note) <> ''");
    });
  }

  for (const table of TABLES) await ensureTenantDistribution(knex, table);
};

/** @param { import("knex").Knex } knex */
exports.down = async function down(knex) {
  // Never discard responsibility state or handoff receipts when an operator rolls back.
  for (const table of TABLES) {
    if ((await knex.schema.hasTable(table)) && (await knex(table).first())) {
      throw new Error(`Cannot roll back nonempty ${table}`);
    }
  }
  for (const table of [...TABLES].reverse()) await knex.schema.dropTableIfExists(table);
};
