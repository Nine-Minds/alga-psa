'use strict';

/**
 * user_client_portfolios — the clients a user is responsible for (alga-2026-0003199).
 *
 * One row per (user, client). The authorization kernel's `client_portfolio` template reads the
 * set as `subject.portfolioClientIds`; a user with no rows has no portfolio, and the template
 * then denies. Nothing reads or writes the table until the subject resolver and the portfolio
 * editor land (plan: ee/docs/plans/2026-11-10-authorization-client-scope-completion).
 *
 * Citus: new table, no pre-existing rows. The primary key and the client-side unique index both
 * lead with the distribution column (`tenant`); composite foreign keys are added after
 * distribution. The client-side index is the one a client merge and "who holds this client"
 * lookups use; it is built CONCURRENTLY so re-running against a populated table never blocks
 * writes.
 */

const TABLE = 'user_client_portfolios';
const CLIENT_INDEX = 'user_client_portfolios_tenant_client_user_uq';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('user_id').notNullable();
      table.uuid('client_id').notNullable();

      table.primary(['tenant', 'user_id', 'client_id']);
    });
  }

  const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');
  await ensureTenantDistribution(knex, TABLE);

  await knex.raw(`
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${CLIENT_INDEX}
    ON ${TABLE} (tenant, client_id, user_id)
  `);

  await ensureCompositeFk(knex, {
    table: TABLE,
    constraint: `${TABLE}_user_foreign`,
    columns: ['tenant', 'user_id'],
    referencedTable: 'users',
    referencedColumns: ['tenant', 'user_id'],
    onDelete: 'CASCADE',
  });
  await ensureCompositeFk(knex, {
    table: TABLE,
    constraint: `${TABLE}_client_foreign`,
    columns: ['tenant', 'client_id'],
    referencedTable: 'clients',
    referencedColumns: ['tenant', 'client_id'],
    onDelete: 'CASCADE',
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};

// create_distributed_table and CREATE INDEX CONCURRENTLY cannot run inside a transaction.
exports.config = { transaction: false };
