'use strict';

/**
 * First-class recurring ticket definitions.
 *
 *   recurring_ticket_definitions         the ticket template + schedule (one definition → many clients)
 *   recurring_ticket_definition_clients  one row per targeted client: overrides, contact/location, watermark
 *   recurring_ticket_client_assets       assets linked to every ticket generated for a client
 *   recurring_ticket_occurrences         run history AND the idempotency ledger
 *
 * Deliberate foreign-key omissions (plan §4.2):
 *   - occurrences.definition_client_id has no FK: removing a client from a definition keeps its
 *     history, so the occurrence rows must not cascade with the client row.
 *   - occurrences.ticket_id has no FK: tickets can be deleted, and ON DELETE SET NULL is not
 *     supported on Citus. The badge lookup simply finds nothing for a deleted ticket.
 *   - template/override board, status, priority, category, user, contact and location references are
 *     validated when saved and re-validated by the generator on every run (a dangling reference
 *     becomes a `failed` occurrence with an actionable reason rather than a blocked delete).
 *
 * The unique key (tenant, definition_client_id, occurrence_date) is the idempotency key. It is keyed
 * on the NOMINAL rule date so changing the non-business-day policy can never re-fire a date.
 */

const DEFINITIONS = 'recurring_ticket_definitions';
const CLIENTS = 'recurring_ticket_definition_clients';
const ASSETS = 'recurring_ticket_client_assets';
const OCCURRENCES = 'recurring_ticket_occurrences';

async function constraintExists(knex, tableName, constraintName) {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = ? AND conrelid = ?::regclass
    ) AS present`,
    [constraintName, tableName]
  );
  return Boolean(result.rows?.[0]?.present);
}

async function addConstraint(knex, tableName, constraintName, definition) {
  if (await constraintExists(knex, tableName, constraintName)) return;
  await knex.raw(`ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${definition}`);
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(DEFINITIONS))) {
    await knex.schema.createTable(DEFINITIONS, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('definition_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('name').notNullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamp('archived_at', { useTz: true }).nullable();

      // Template
      table.text('title_template').notNullable();
      table.jsonb('description').nullable();
      table.uuid('board_id').notNullable();
      table.uuid('status_id').nullable(); // null = the board's default status
      table.uuid('priority_id').notNullable();
      table.uuid('category_id').nullable();
      table.uuid('subcategory_id').nullable();
      table.uuid('assigned_to').nullable();
      table.uuid('assigned_team_id').nullable();
      table.jsonb('additional_agent_ids').notNullable().defaultTo('[]');
      table.jsonb('tags').notNullable().defaultTo('[]');
      table.uuid('checklist_template_id').nullable();

      // Schedule
      table.jsonb('recurrence').notNullable();
      table.date('start_date').notNullable();
      table.text('create_time').notNullable().defaultTo('08:00');
      table.text('due_time').notNullable().defaultTo('17:00');
      table.integer('lead_days').notNullable().defaultTo(0);
      table.text('non_business_day_policy').notNullable().defaultTo('keep');

      // Behaviour
      table.text('open_previous_policy').notNullable().defaultTo('always_create');
      table.boolean('notify_client_on_create').notNullable().defaultTo(false);

      // Audit
      table.uuid('created_by').nullable();
      table.uuid('updated_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'definition_id']);
    });
  }

  if (!(await knex.schema.hasTable(CLIENTS))) {
    await knex.schema.createTable(CLIENTS, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('definition_client_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('definition_id').notNullable();
      table.uuid('client_id').notNullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.jsonb('overrides').notNullable().defaultTo('{}');
      table.uuid('contact_id').nullable();
      table.uuid('location_id').nullable();
      // Window watermark (plan §4.4): reset to now() whenever the row starts or resumes being active.
      table.timestamp('evaluated_through', { useTz: true }).notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'definition_client_id']);
      table.unique(['tenant', 'definition_id', 'client_id'], {
        indexName: 'recurring_ticket_definition_clients_definition_client_unique',
      });
    });
  }

  if (!(await knex.schema.hasTable(ASSETS))) {
    await knex.schema.createTable(ASSETS, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('definition_client_id').notNullable();
      table.uuid('asset_id').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'definition_client_id', 'asset_id']);
    });
  }

  if (!(await knex.schema.hasTable(OCCURRENCES))) {
    await knex.schema.createTable(OCCURRENCES, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('occurrence_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('definition_id').notNullable();
      table.uuid('definition_client_id').notNullable();
      table.uuid('client_id').notNullable();
      table.date('occurrence_date').notNullable(); // nominal rule date, before business-day adjustment
      table.date('due_date').notNullable(); // adjusted date
      table.timestamp('create_at', { useTz: true }).nullable();
      table.timestamp('due_at', { useTz: true }).nullable();
      table.text('status').notNullable();
      table.uuid('ticket_id').nullable();
      table.text('reason').nullable();
      table.integer('attempts').notNullable().defaultTo(0);
      table.timestamp('last_attempt_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'occurrence_id']);
      table.unique(['tenant', 'definition_client_id', 'occurrence_date'], {
        indexName: 'recurring_ticket_occurrences_idempotency_unique',
      });
    });
  }

  // Check constraints (guarded for re-runs).
  await addConstraint(knex, DEFINITIONS, `${DEFINITIONS}_lead_days_check`,
    'CHECK (lead_days >= 0 AND lead_days <= 365)');
  await addConstraint(knex, DEFINITIONS, `${DEFINITIONS}_non_business_day_policy_check`,
    "CHECK (non_business_day_policy IN ('keep', 'previous', 'next'))");
  await addConstraint(knex, DEFINITIONS, `${DEFINITIONS}_open_previous_policy_check`,
    "CHECK (open_previous_policy IN ('always_create', 'skip'))");
  await addConstraint(knex, OCCURRENCES, `${OCCURRENCES}_status_check`,
    "CHECK (status IN ('created', 'skipped', 'missed', 'failed'))");

  // Indexes
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${DEFINITIONS}_active
    ON ${DEFINITIONS} (tenant, is_active)
    WHERE archived_at IS NULL
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${CLIENTS}_client
    ON ${CLIENTS} (tenant, client_id)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${OCCURRENCES}_ticket
    ON ${OCCURRENCES} (tenant, ticket_id)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${OCCURRENCES}_definition_due
    ON ${OCCURRENCES} (tenant, definition_id, due_at DESC)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${OCCURRENCES}_definition_client_due
    ON ${OCCURRENCES} (tenant, definition_client_id, due_at DESC)
  `);

  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
  for (const table of [DEFINITIONS, CLIENTS, ASSETS, OCCURRENCES]) {
    await ensureTenantDistribution(knex, table);
  }

  // Tenant-composite foreign keys, added after distribution.
  for (const table of [DEFINITIONS, CLIENTS, ASSETS, OCCURRENCES]) {
    await addConstraint(knex, table, `${table}_tenant_foreign`,
      'FOREIGN KEY (tenant) REFERENCES tenants(tenant)');
  }
  await addConstraint(knex, CLIENTS, `${CLIENTS}_definition_foreign`,
    `FOREIGN KEY (tenant, definition_id) REFERENCES ${DEFINITIONS} (tenant, definition_id) ON DELETE CASCADE`);
  await addConstraint(knex, CLIENTS, `${CLIENTS}_client_foreign`,
    'FOREIGN KEY (tenant, client_id) REFERENCES clients (tenant, client_id) ON DELETE CASCADE');
  await addConstraint(knex, ASSETS, `${ASSETS}_definition_client_foreign`,
    `FOREIGN KEY (tenant, definition_client_id) REFERENCES ${CLIENTS} (tenant, definition_client_id) ON DELETE CASCADE`);
  await addConstraint(knex, ASSETS, `${ASSETS}_asset_foreign`,
    'FOREIGN KEY (tenant, asset_id) REFERENCES assets (tenant, asset_id) ON DELETE CASCADE');
  await addConstraint(knex, OCCURRENCES, `${OCCURRENCES}_definition_foreign`,
    `FOREIGN KEY (tenant, definition_id) REFERENCES ${DEFINITIONS} (tenant, definition_id) ON DELETE CASCADE`);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(OCCURRENCES);
  await knex.schema.dropTableIfExists(ASSETS);
  await knex.schema.dropTableIfExists(CLIENTS);
  await knex.schema.dropTableIfExists(DEFINITIONS);
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };
