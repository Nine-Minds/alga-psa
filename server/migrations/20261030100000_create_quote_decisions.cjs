const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');

const TABLE = 'quote_decisions';

/**
 * quote_decisions: append-only audit of who accepted/rejected a quote and how.
 *
 * quotes.accepted_at / accepted_by stay as the denormalised current state; this table
 * is the record that can also describe a decision made by a contact who has no `users`
 * row (email-link acceptance), so actor_user_id and contact_id are both nullable.
 * link_id has no FK yet - the access-link table arrives in a later migration.
 *
 * Citus: tenant leads the PK and every FK, and the table is distributed on tenant,
 * colocated with `tenants`. users is keyed (tenant, user_id, email) but carries the
 * unique (tenant, user_id) the FK targets, same as quote_activities.performed_by.
 * ON DELETE SET NULL uses a column list so the tenant column is never nulled (plain
 * Postgres 15+ only; Citus / older PG use NO ACTION).
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      tenant uuid NOT NULL,
      decision_id uuid NOT NULL DEFAULT gen_random_uuid(),
      quote_id uuid NOT NULL,
      decision text NOT NULL,
      method text NOT NULL,
      actor_user_id uuid NULL,
      contact_id uuid NULL,
      link_id uuid NULL,
      signer_name text NULL,
      signer_email text NULL,
      signer_title text NULL,
      comment text NULL,
      selections jsonb NOT NULL DEFAULT '{}'::jsonb,
      agreement_text_hash text NULL,
      ip text NULL,
      user_agent text NULL,
      decided_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ${TABLE}_pkey PRIMARY KEY (tenant, decision_id),
      CONSTRAINT ${TABLE}_decision_check CHECK (decision IN ('accepted', 'rejected')),
      CONSTRAINT ${TABLE}_method_check CHECK (method IN ('portal', 'email_link', 'msp_marked')),
      CONSTRAINT ${TABLE}_tenant_foreign FOREIGN KEY (tenant) REFERENCES tenants (tenant)
    )
  `);
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS idx_${TABLE}_tenant_quote_decided_at ON ${TABLE} (tenant, quote_id, decided_at)`
  );

  await ensureTenantDistribution(knex, TABLE);

  // SET NULL (col) needs PG 15+ and is refused by Citus when the distribution key is part
  // of the FK; elsewhere fall back to NO ACTION (same recipe as
  // 20260719120000_fix_suppression_contact_fk_set_null.cjs).
  const citusRow = await knex.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus' LIMIT 1");
  const versionRow = await knex.raw("SELECT current_setting('server_version_num')::int AS v");
  const columnTargeted = versionRow.rows[0].v >= 150000 && citusRow.rows.length === 0;

  await ensureCompositeFk(knex, {
    table: TABLE,
    constraint: `${TABLE}_tenant_quote_id_foreign`,
    columns: ['tenant', 'quote_id'],
    referencedTable: 'quotes',
    referencedColumns: ['tenant', 'quote_id'],
    onDelete: 'CASCADE',
  });
  await ensureCompositeFk(knex, {
    table: TABLE,
    constraint: `${TABLE}_tenant_actor_user_id_foreign`,
    columns: ['tenant', 'actor_user_id'],
    referencedTable: 'users',
    referencedColumns: ['tenant', 'user_id'],
    onDelete: columnTargeted ? 'SET NULL (actor_user_id)' : undefined,
  });
  await ensureCompositeFk(knex, {
    table: TABLE,
    constraint: `${TABLE}_tenant_contact_id_foreign`,
    columns: ['tenant', 'contact_id'],
    referencedTable: 'contacts',
    referencedColumns: ['tenant', 'contact_name_id'],
    onDelete: columnTargeted ? 'SET NULL (contact_id)' : undefined,
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};
