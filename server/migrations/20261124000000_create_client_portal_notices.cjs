'use strict';

/**
 * Client Portal Notices — three tenant-scoped tables (plan pl-737e90f8, S1).
 *
 *   client_portal_notices            the notice itself (severity, localized content, schedule, audience)
 *   client_portal_notice_targets     client / tag targets for audience_type 'clients' | 'tags'
 *   client_portal_notice_dismissals  per-user, server-side dismissals
 *
 * No foreign keys on purpose: relations (notice -> targets/dismissals, target ->
 * client/tag, user) are enforced in the application, per house style, so these
 * tables can be hash-distributed on Citus without cross-table FK constraints.
 *
 * Citus: every table is distributed on `tenant`, colocated with `tenants`, via
 * ensureTenantDistribution (a no-op on plain Postgres). Every primary key,
 * unique constraint and index leads with `tenant`. New tables, no existing rows.
 *
 * Idempotent: guarded by hasTable, IF NOT EXISTS on indexes, and constraints are
 * declared inline in CREATE TABLE. `transaction: false` because
 * create_distributed_table cannot run inside a transaction.
 */

const NOTICES = 'client_portal_notices';
const TARGETS = 'client_portal_notice_targets';
const DISMISSALS = 'client_portal_notice_dismissals';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(NOTICES))) {
    await knex.raw(`
      CREATE TABLE IF NOT EXISTS ${NOTICES} (
        tenant uuid NOT NULL,
        notice_id uuid NOT NULL,
        severity text NOT NULL,
        content jsonb NOT NULL,
        link_url text NULL,
        starts_at timestamptz NULL,
        ends_at timestamptz NULL,
        dismissible boolean NOT NULL,
        audience_type text NOT NULL,
        created_by uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT client_portal_notices_pkey PRIMARY KEY (tenant, notice_id),
        CONSTRAINT client_portal_notices_severity_check
          CHECK (severity IN ('info', 'warning', 'critical')),
        CONSTRAINT client_portal_notices_audience_type_check
          CHECK (audience_type IN ('all', 'clients', 'tags')),
        CONSTRAINT client_portal_notices_schedule_check
          CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
      )
    `);
  }
  // Live-notice lookup per tenant (S4 read path).
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS client_portal_notices_live_idx
    ON ${NOTICES} (tenant, starts_at, ends_at)
  `);

  if (!(await knex.schema.hasTable(TARGETS))) {
    await knex.raw(`
      CREATE TABLE IF NOT EXISTS ${TARGETS} (
        tenant uuid NOT NULL,
        notice_id uuid NOT NULL,
        target_type text NOT NULL,
        target_id uuid NOT NULL,
        CONSTRAINT client_portal_notice_targets_pkey
          PRIMARY KEY (tenant, notice_id, target_type, target_id),
        CONSTRAINT client_portal_notice_targets_target_type_check
          CHECK (target_type IN ('client', 'tag'))
      )
    `);
  }
  // Audience lookup: which notices target this client / tag.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS client_portal_notice_targets_lookup_idx
    ON ${TARGETS} (tenant, target_type, target_id)
  `);

  if (!(await knex.schema.hasTable(DISMISSALS))) {
    await knex.raw(`
      CREATE TABLE IF NOT EXISTS ${DISMISSALS} (
        tenant uuid NOT NULL,
        notice_id uuid NOT NULL,
        user_id uuid NOT NULL,
        dismissed_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT client_portal_notice_dismissals_pkey
          PRIMARY KEY (tenant, notice_id, user_id)
      )
    `);
  }

  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
  for (const table of [NOTICES, TARGETS, DISMISSALS]) {
    await ensureTenantDistribution(knex, table);
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(DISMISSALS);
  await knex.schema.dropTableIfExists(TARGETS);
  await knex.schema.dropTableIfExists(NOTICES);
};

// create_distributed_table cannot run inside a transaction.
exports.config = { transaction: false };
