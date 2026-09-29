/**
 * Ticket bundle status propagation ledger (2026-09-18)
 *
 * Records which children a sync-mode master close actually closed, so a later
 * master reopen reverses only those children. Children closed independently
 * (before bundling, or added closed) have no active row and stay closed.
 *
 * See ee/docs/plans/2026-09-18-ticket-bundle-sync-status-propagation-warning.
 *
 * Composite (tenant, id) primary key, Citus distribution by tenant, no RLS —
 * application-level tenant scoping, following ticket_bundle_settings.
 */

const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLE = 'ticket_bundle_status_propagations';

async function addForeignKeyIfMissing(knex, constraintName, sql) {
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = '${constraintName}'
      ) THEN
        ${sql};
      END IF;
    END $$;
  `);
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('propagation_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('master_ticket_id').notNullable();
      table.uuid('child_ticket_id').notNullable();
      table.text('action').notNullable().defaultTo('close');
      table.uuid('child_previous_status_id').nullable();
      table.uuid('propagated_by').nullable();
      table.timestamp('propagated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('reverted_at', { useTz: true }).nullable();
      table.uuid('reverted_by').nullable();

      table.primary(['tenant', 'propagation_id']);
    });

    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${TABLE}_action_check
      CHECK (action IN ('close'))
    `);

    // At most one active propagation row per child: a second close without an
    // intervening reopen violates this.
    await knex.raw(`
      CREATE UNIQUE INDEX ${TABLE}_active_child_unique
      ON ${TABLE} (tenant, child_ticket_id)
      WHERE reverted_at IS NULL
    `);

    await knex.raw(`
      CREATE INDEX ${TABLE}_master_idx
      ON ${TABLE} (tenant, master_ticket_id)
    `);
  }

  // Distribute before FKs — Citus requires both sides distributed first.
  await ensureTenantDistribution(knex, TABLE);

  await addForeignKeyIfMissing(knex, `${TABLE}_tenant_fkey`, `
    ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${TABLE}_tenant_fkey
      FOREIGN KEY (tenant)
      REFERENCES tenants(tenant)
      ON DELETE CASCADE
  `);

  await addForeignKeyIfMissing(knex, `${TABLE}_master_fkey`, `
    ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${TABLE}_master_fkey
      FOREIGN KEY (tenant, master_ticket_id)
      REFERENCES tickets(tenant, ticket_id)
      ON DELETE CASCADE
  `);

  await addForeignKeyIfMissing(knex, `${TABLE}_child_fkey`, `
    ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${TABLE}_child_fkey
      FOREIGN KEY (tenant, child_ticket_id)
      REFERENCES tickets(tenant, ticket_id)
      ON DELETE CASCADE
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};

// Citus requires FK manipulation / distribution to run outside a transaction.
exports.config = { transaction: false };
