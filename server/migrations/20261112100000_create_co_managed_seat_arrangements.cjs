/**
 * Co-managed seat and workspace shapes on one seat pool, slice S5 (F012).
 *
 * The seat shape's durable rows, all in the SPONSOR (MSP) tenant:
 *
 * - `co_managed_seat_arrangements`: one client's seat arrangement. It binds the client to the
 *   seat-kind `co_managed_allocations` row that pays for it. A client has at most one live one.
 * - `co_managed_seat_board_scopes`: one board in an arrangement's scope, and whether its
 *   technicians may create tickets there. No rows means no ticket access.
 * - `co_managed_seat_assignments`: one technician seat. Invited first; the user is recorded once
 *   the invitation is accepted. A user holds at most one live assignment.
 * - `co_managed_seat_project_grants`: one project shared with an arrangement.
 *
 * Like the rest of the co-managed ledger (20261028130000): every key leads with `tenant` (the
 * Citus distribution column), there are no foreign keys and no triggers, and invariants live in
 * CHECKs, unique indexes and the commands that write the rows. Additive only: nothing reads or
 * writes these tables until the arrangement commands are called.
 *
 * Idempotent; safe to re-run over an already migrated database.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLES = [
  'co_managed_seat_arrangements',
  'co_managed_seat_board_scopes',
  'co_managed_seat_assignments',
  'co_managed_seat_project_grants',
];

/** @param { import("knex").Knex } knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('co_managed_seat_arrangements'))) {
    await knex.schema.createTable('co_managed_seat_arrangements', (table) => {
      table.uuid('tenant').notNullable(); // Sponsoring MSP.
      table.uuid('arrangement_id').notNullable();
      table.uuid('client_id').notNullable();
      table.uuid('allocation_id').notNullable(); // The seat-kind co_managed_allocations row.
      table.text('state').notNullable().defaultTo('active');
      table.jsonb('handoff_defaults').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.jsonb('settings').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.integer('revision').notNullable().defaultTo(1);
      table.timestamp('ended_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'arrangement_id']);
      // One arrangement per allocation: this is what an operation replay resolves through.
      table.unique(['tenant', 'allocation_id']);
      table.check("state IN ('active', 'ended')");
      table.check("(state = 'ended') = (ended_at IS NOT NULL)");
      table.check('revision > 0');
      table.check("jsonb_typeof(handoff_defaults) = 'object'");
      table.check("jsonb_typeof(settings) = 'object'");
    });
  }
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS co_managed_one_live_seat_arrangement
    ON co_managed_seat_arrangements (tenant, client_id) WHERE state <> 'ended'`);

  if (!(await knex.schema.hasTable('co_managed_seat_board_scopes'))) {
    await knex.schema.createTable('co_managed_seat_board_scopes', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('arrangement_id').notNullable();
      table.uuid('board_id').notNullable();
      table.boolean('can_create').notNullable().defaultTo(false);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'arrangement_id', 'board_id']);
    });
  }

  if (!(await knex.schema.hasTable('co_managed_seat_assignments'))) {
    await knex.schema.createTable('co_managed_seat_assignments', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('assignment_id').notNullable();
      table.uuid('arrangement_id').notNullable();
      table.uuid('invitation_id').nullable();
      table.uuid('user_id').nullable(); // Recorded when the invitation is accepted.
      table.text('state').notNullable().defaultTo('invited');
      table.timestamp('revoked_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'assignment_id']);
      table.check("state IN ('invited', 'active', 'revoked')");
      table.check("state <> 'active' OR user_id IS NOT NULL");
      table.check("(state = 'revoked') = (revoked_at IS NOT NULL)");
    });
  }
  await knex.raw(`CREATE INDEX IF NOT EXISTS co_managed_seat_assignments_arrangement_index
    ON co_managed_seat_assignments (tenant, arrangement_id)`);
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS co_managed_one_live_seat_assignment
    ON co_managed_seat_assignments (tenant, user_id) WHERE state <> 'revoked' AND user_id IS NOT NULL`);

  if (!(await knex.schema.hasTable('co_managed_seat_project_grants'))) {
    await knex.schema.createTable('co_managed_seat_project_grants', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('arrangement_id').notNullable();
      table.uuid('project_id').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'arrangement_id', 'project_id']);
    });
  }

  for (const table of TABLES) await ensureTenantDistribution(knex, table);
};

/** @param { import("knex").Knex } knex */
exports.down = async function down(knex) {
  // Never discard a live arrangement or its technicians when an operator rolls back.
  for (const table of TABLES) {
    if ((await knex.schema.hasTable(table)) && (await knex(table).first())) {
      throw new Error(`Cannot roll back nonempty ${table}`);
    }
  }
  for (const table of [...TABLES].reverse()) await knex.schema.dropTableIfExists(table);
};
