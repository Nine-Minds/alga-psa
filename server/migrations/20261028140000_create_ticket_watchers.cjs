'use strict';

/**
 * ticket_watchers: the source of truth for who is copied on ticket updates.
 *
 * `tickets.attributes.watch_list` stays for one release as a derived mirror that
 * TicketWatcherService rewrites from this table inside the same transaction
 * (after SELECT ... FOR UPDATE on the ticket row). Nothing else writes it.
 *
 * Email is the public key: unique per (tenant, ticket_id, lower(email)).
 * `watcher_id` is an internal surrogate that exists only because a Citus primary
 * key must contain `tenant` and cannot contain an expression; it is never
 * exposed by the API.
 *
 * Citus: the table is new, distributed on `tenant` colocated with `tenants`.
 * Every unique index (PK and the lower(email) index) includes `tenant` and is
 * created after distribution. The FK to tickets is composite (tenant, ticket_id)
 * and is added through ensureCompositeFk, which skips it when `tickets` and this
 * table do not share a distribution state. create_distributed_table cannot run
 * in a transaction block, hence `transaction: false`; every step is idempotent.
 *
 * Backfill mirrors shared/lib/tickets/watchList.ts normalizeTicketWatchListEntries:
 * entries may be bare strings or objects; email is extracted and lower-cased,
 * entries are deduped by email (active = OR, first non-empty name/source/entity
 * wins, in list order), only user|contact entity types are kept, and entries
 * without a usable email are dropped.
 */

const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');

const TABLE = 'ticket_watchers';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('watcher_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('ticket_id').notNullable();
      table.text('email').notNullable();
      table.text('name').nullable();
      table.boolean('active').notNullable().defaultTo(true);
      table.text('entity_type').nullable();
      table.uuid('entity_id').nullable();
      table.text('source').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'watcher_id']);
    });

    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${TABLE}_entity_type_check
      CHECK (entity_type IS NULL OR entity_type IN ('user', 'contact'))
    `);
  }

  await ensureTenantDistribution(knex, TABLE);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${TABLE}_ticket_email_unique
    ON ${TABLE} (tenant, ticket_id, lower(email))
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${TABLE}_ticket
    ON ${TABLE} (tenant, ticket_id)
  `);

  await ensureCompositeFk(knex, {
    table: TABLE,
    constraint: `${TABLE}_ticket_foreign`,
    columns: ['tenant', 'ticket_id'],
    referencedTable: 'tickets',
    referencedColumns: ['tenant', 'ticket_id'],
    onDelete: 'CASCADE',
  });

  // Backfill from tickets.attributes.watch_list. Idempotent (ON CONFLICT DO NOTHING).
  const uuidRe = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  await knex.raw(
    `
    WITH raw_entries AS (
      SELECT
        t.tenant,
        t.ticket_id,
        e.ord,
        CASE WHEN jsonb_typeof(e.item) = 'string' THEN e.item #>> '{}' ELSE e.item ->> 'email' END AS raw_email,
        CASE WHEN jsonb_typeof(e.item) = 'object' THEN e.item -> 'active' END AS raw_active,
        CASE WHEN jsonb_typeof(e.item) = 'object' THEN NULLIF(btrim(e.item ->> 'name'), '') END AS name,
        CASE WHEN jsonb_typeof(e.item) = 'object' THEN NULLIF(btrim(e.item ->> 'source'), '') END AS source,
        CASE WHEN jsonb_typeof(e.item) = 'object' AND lower(btrim(e.item ->> 'entity_type')) IN ('user', 'contact')
             THEN lower(btrim(e.item ->> 'entity_type')) END AS entity_type,
        CASE WHEN jsonb_typeof(e.item) = 'object' AND btrim(e.item ->> 'entity_id') ~ ?
             THEN btrim(e.item ->> 'entity_id')::uuid END AS entity_id,
        CASE WHEN jsonb_typeof(e.item) = 'object' THEN
          CASE WHEN (e.item ->> 'created_at') ~ '^\\d{4}-\\d{2}-\\d{2}' THEN (e.item ->> 'created_at')::timestamptz END
        END AS created_at
      FROM tickets t
      CROSS JOIN LATERAL jsonb_array_elements(t.attributes -> 'watch_list') WITH ORDINALITY AS e(item, ord)
      WHERE jsonb_typeof(t.attributes -> 'watch_list') = 'array'
    ),
    normalized AS (
      SELECT
        tenant, ticket_id, ord, name, source, entity_type, entity_id, created_at,
        lower(substring(raw_email from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+')) AS email,
        CASE
          WHEN raw_active IS NULL THEN true
          WHEN jsonb_typeof(raw_active) = 'boolean' THEN (raw_active #>> '{}')::boolean
          WHEN jsonb_typeof(raw_active) = 'number' THEN (raw_active #>> '{}')::numeric <> 0
          WHEN jsonb_typeof(raw_active) = 'string' THEN
            CASE WHEN btrim(raw_active #>> '{}') = '' THEN true
                 ELSE lower(btrim(raw_active #>> '{}')) NOT IN ('false', '0', 'off', 'no') END
          ELSE true
        END AS active
      FROM raw_entries
    )
    INSERT INTO ${TABLE} (tenant, ticket_id, email, name, active, entity_type, entity_id, source, created_at, updated_at)
    SELECT
      tenant,
      ticket_id,
      email,
      (array_agg(name ORDER BY ord) FILTER (WHERE name IS NOT NULL))[1],
      bool_or(active),
      (array_agg(entity_type ORDER BY ord) FILTER (WHERE entity_type IS NOT NULL))[1],
      (array_agg(entity_id ORDER BY ord) FILTER (WHERE entity_id IS NOT NULL))[1],
      (array_agg(source ORDER BY ord) FILTER (WHERE source IS NOT NULL))[1],
      COALESCE(min(created_at), now()),
      now()
    FROM normalized
    WHERE email IS NOT NULL
    GROUP BY tenant, ticket_id, email
    ON CONFLICT DO NOTHING
    `,
    [uuidRe]
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};

exports.config = { transaction: false };
