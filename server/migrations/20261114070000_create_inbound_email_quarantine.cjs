'use strict';

/**
 * inbound_email_quarantine — durable record of inbound emails that
 * processInboundEmailInApp refused (outcome 'quarantined'), so an MSP admin can
 * see and act on them (alga-2026-0003119).
 *
 * Stores NO message bodies and NO raw headers: only the sender, a truncated
 * subject, the mailbox, the reason, the matched ticket, and a sha256 of the
 * Message-ID used to dedupe redelivery (unique per tenant + provider + hash).
 *
 * `reason` is deliberately NOT constrained in the database. The closed set is
 * QUARANTINE_REASONS in shared/services/email/inboundQuarantineConstants.ts
 * (enforced by the TypeScript type); a CHECK here would make an INSERT for a
 * newly added reason fail, and the best-effort surfacing would swallow that and
 * lose the quarantine. Adding a reason therefore needs no migration.
 *
 * Citus: new table, no pre-existing rows. Primary key and every index lead with
 * the distribution column (`tenant`). No foreign keys on purpose: a quarantine
 * row must outlive its provider and ticket (mailbox address and ticket number
 * are denormalized onto the row for exactly that reason).
 */

const TABLE = 'inbound_email_quarantine';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('id').notNullable();

      table.uuid('provider_id').notNullable();
      table.text('mailbox').notNullable().defaultTo('');
      table.text('sender').notNullable().defaultTo('');
      table.text('subject').notNullable().defaultTo('');

      table.timestamp('received_at', { useTz: true }).notNullable();
      table.timestamp('quarantined_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.text('reason').notNullable();
      table.text('matched_by').nullable();

      table.uuid('ticket_id').nullable();
      table.text('ticket_number').nullable();

      // sha256 hex of the normalized Message-ID; redelivery dedupe key.
      table.text('message_id_hash').notNullable();

      table.text('status').notNullable().defaultTo('open');
      table.uuid('dismissed_by').nullable();
      table.timestamp('dismissed_at', { useTz: true }).nullable();

      // Notification throttle window claim (one notification burst per tenant+mailbox+reason / 15 min).
      table.timestamp('notified_at', { useTz: true }).nullable();

      table.primary(['tenant', 'id']);
      table.unique(['tenant', 'provider_id', 'message_id_hash'], {
        indexName: 'inbound_email_quarantine_dedupe_unique',
      });
    });
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT inbound_email_quarantine_status_check
      CHECK (status IN ('open', 'dismissed'))
    `);
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT inbound_email_quarantine_matched_by_check
      CHECK (matched_by IS NULL OR matched_by IN ('thread_headers', 'reply_token'))
    `);
    await knex.raw(`
      CREATE INDEX inbound_email_quarantine_queue_idx
      ON ${TABLE} (tenant, status, quarantined_at DESC)
    `);
    await knex.raw(`
      CREATE INDEX inbound_email_quarantine_ticket_idx
      ON ${TABLE} (tenant, ticket_id) WHERE ticket_id IS NOT NULL
    `);
    await knex.raw(`
      CREATE INDEX inbound_email_quarantine_mailbox_day_idx
      ON ${TABLE} (tenant, provider_id, quarantined_at)
    `);
    await knex.raw(`
      CREATE INDEX inbound_email_quarantine_dismissed_retention_idx
      ON ${TABLE} (dismissed_at) WHERE status = 'dismissed'
    `);
  }

  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
  await ensureTenantDistribution(knex, TABLE);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};

// create_distributed_table cannot run inside a transaction.
exports.config = { transaction: false };
