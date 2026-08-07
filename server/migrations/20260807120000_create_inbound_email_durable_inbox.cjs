/**
 * Durable inbound email processing ledgers.
 *
 * Adds five tenant-distributed, tenant-colocated tables that make inbound email
 * effects exactly-once within Postgres while Redis stays an at-least-once
 * wake-up mechanism:
 *
 *   - inbound_email_ingress: one durable provider pointer / already-available
 *     source handoff. Claims are token/version fenced.
 *   - inbound_email_inbox: one row per staged provider message and the
 *     authoritative core state machine (received -> processing -> terminal).
 *   - inbound_email_effects: the second, independent guard that a message can
 *     own at most one ticket effect and at most one comment effect.
 *   - inbound_email_artifacts: per-artifact resumable persistence ledger.
 *   - inbound_email_outbox: one durable row per semantic event caused by the
 *     core transaction, published later by the dispatcher.
 *
 * The legacy `email_processed_messages` / `email_processed_attachments` audit
 * tables are intentionally NOT altered or dropped; they remain compatibility /
 * reporting surfaces and are mirrored after the core commit.
 *
 * All primary keys, unique constraints and unique indexes include `tenant`.
 * All tables are distributed on `tenant` and colocated with `tenants`. The only
 * foreign keys are composite (tenant, ...) within this table family; there are
 * no FKs to email_providers, tickets, comments, files or documents so that
 * entity deletion cannot destroy audit history and deletion-order coupling is
 * avoided.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

  // -------------------------------------------------------------------------
  // inbound_email_ingress
  // -------------------------------------------------------------------------
  const hasIngress = await knex.schema.hasTable('inbound_email_ingress');
  if (!hasIngress) {
    await knex.schema.createTable('inbound_email_ingress', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('ingress_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('provider_id').notNullable();
      table.text('provider_type').notNullable();
      table.text('ingress_key').notNullable();
      table.jsonb('provider_pointer').notNullable();
      table.text('status').notNullable().defaultTo('received');
      table.integer('attempt_count').notNullable().defaultTo(0);
      table.text('lease_owner').nullable();
      table.uuid('lease_token').nullable();
      table.bigint('lease_version').notNullable().defaultTo(0);
      table.timestamp('lease_expires_at', { useTz: true }).nullable();
      table.timestamp('next_attempt_at', { useTz: true }).nullable();
      table.text('last_error').nullable();
      table.jsonb('error_details').nullable();
      table.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('completed_at', { useTz: true }).nullable();

      table.primary(['tenant', 'ingress_id']);
      table.unique(['tenant', 'provider_id', 'ingress_key'], {
        indexName: 'inbound_email_ingress_provider_key_unique',
      });
      table.check(
        "status IN ('received','staging','staged','retryable_failed','terminal_failed')",
        undefined,
        'inbound_email_ingress_status_check'
      );
      table.check(
        "status <> 'staging' OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)",
        undefined,
        'inbound_email_ingress_staging_lease_check'
      );
      table.check(
        "status <> 'retryable_failed' OR next_attempt_at IS NOT NULL",
        undefined,
        'inbound_email_ingress_retryable_next_attempt_check'
      );
      table.check(
        "status NOT IN ('staged','terminal_failed') OR (completed_at IS NOT NULL AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)",
        undefined,
        'inbound_email_ingress_terminal_lease_check'
      );
      table.check('attempt_count >= 0', undefined, 'inbound_email_ingress_attempt_count_check');
      table.index(['tenant', 'status', 'next_attempt_at', 'lease_expires_at'], 'inbound_email_ingress_due_idx');
    });
    await ensureTenantDistribution(knex, 'inbound_email_ingress');
  }

  // -------------------------------------------------------------------------
  // inbound_email_inbox
  // -------------------------------------------------------------------------
  const hasInbox = await knex.schema.hasTable('inbound_email_inbox');
  if (!hasInbox) {
    await knex.schema.createTable('inbound_email_inbox', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('inbox_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('ingress_id').nullable();
      table.uuid('provider_id').notNullable();
      table.text('provider_type').notNullable();
      table.text('normalized_message_id').notNullable();
      table.text('provider_message_id').nullable();
      table.text('rfc_message_id').nullable();
      table.text('source_object_key').nullable();
      table.text('source_sha256').nullable();
      table.bigint('source_size_bytes').nullable();
      table.timestamp('source_staged_at', { useTz: true }).nullable();
      table.jsonb('envelope').notNullable();
      table.boolean('legacy_imported').notNullable().defaultTo(false);
      table.text('status').notNullable().defaultTo('received');
      table.integer('attempt_count').notNullable().defaultTo(0);
      table.text('lease_owner').nullable();
      table.uuid('lease_token').nullable();
      table.bigint('lease_version').notNullable().defaultTo(0);
      table.timestamp('lease_expires_at', { useTz: true }).nullable();
      table.timestamp('next_attempt_at', { useTz: true }).nullable();
      table.text('outcome_kind').nullable();
      table.text('outcome_reason').nullable();
      table.uuid('ticket_id').nullable();
      table.uuid('comment_id').nullable();
      table.text('last_error').nullable();
      table.jsonb('error_details').nullable();
      table.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('completed_at', { useTz: true }).nullable();

      table.primary(['tenant', 'inbox_id']);
      table.unique(['tenant', 'provider_id', 'normalized_message_id'], {
        indexName: 'inbound_email_inbox_identity_unique',
      });
      table.foreign(['tenant', 'ingress_id'])
        .references(['tenant', 'ingress_id'])
        .inTable('inbound_email_ingress');
      table.check(
        "status IN ('received','processing','succeeded','skipped','retryable_failed','terminal_failed')",
        undefined,
        'inbound_email_inbox_status_check'
      );
      table.check(
        "status <> 'processing' OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)",
        undefined,
        'inbound_email_inbox_processing_lease_check'
      );
      table.check(
        "status <> 'retryable_failed' OR next_attempt_at IS NOT NULL",
        undefined,
        'inbound_email_inbox_retryable_next_attempt_check'
      );
      table.check(
        "status NOT IN ('succeeded','skipped','terminal_failed') OR (completed_at IS NOT NULL AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)",
        undefined,
        'inbound_email_inbox_terminal_lease_check'
      );
      table.check(
        "(legacy_imported AND status IN ('succeeded','skipped','terminal_failed')) OR (ingress_id IS NOT NULL AND source_object_key IS NOT NULL AND source_sha256 IS NOT NULL AND source_size_bytes IS NOT NULL AND source_staged_at IS NOT NULL)",
        undefined,
        'inbound_email_inbox_source_required_check'
      );
      table.check(
        "status <> 'succeeded' OR (outcome_kind IS NOT NULL AND outcome_kind IN ('created','replied','reconciled') AND ticket_id IS NOT NULL AND comment_id IS NOT NULL)",
        undefined,
        'inbound_email_inbox_succeeded_entities_check'
      );
      table.check(
        "status <> 'skipped' OR (outcome_kind = 'skipped' AND outcome_reason IS NOT NULL)",
        undefined,
        'inbound_email_inbox_skipped_reason_check'
      );
      table.check(
        "outcome_kind <> 'skipped' OR status = 'skipped'",
        undefined,
        'inbound_email_inbox_skipped_status_check'
      );
      table.check(
        "outcome_kind IN ('created','replied','skipped','reconciled')",
        undefined,
        'inbound_email_inbox_outcome_kind_check'
      );
      table.check('attempt_count >= 0', undefined, 'inbound_email_inbox_attempt_count_check');
      table.check('source_size_bytes IS NULL OR source_size_bytes >= 0', undefined, 'inbound_email_inbox_source_size_check');
      table.index(['tenant', 'status', 'next_attempt_at', 'lease_expires_at'], 'inbound_email_inbox_due_idx');
      table.index(
        ['tenant', 'provider_id', 'normalized_message_id', 'status'],
        'inbound_email_inbox_terminal_lookup_idx'
      );
    });
    await ensureTenantDistribution(knex, 'inbound_email_inbox');
  }

  // -------------------------------------------------------------------------
  // inbound_email_effects
  // -------------------------------------------------------------------------
  const hasEffects = await knex.schema.hasTable('inbound_email_effects');
  if (!hasEffects) {
    await knex.schema.createTable('inbound_email_effects', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('provider_id').notNullable();
      table.text('normalized_message_id').notNullable();
      table.text('effect_type').notNullable();
      table.uuid('inbox_id').notNullable();
      table.uuid('entity_id').notNullable();
      table.uuid('ticket_id').notNullable();
      table.boolean('reconciled').notNullable().defaultTo(false);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'provider_id', 'normalized_message_id', 'effect_type']);
      table.unique(['tenant', 'inbox_id', 'effect_type'], 'inbound_email_effects_inbox_effect_unique');
      table.foreign(['tenant', 'inbox_id'])
        .references(['tenant', 'inbox_id'])
        .inTable('inbound_email_inbox');
      table.check(
        "effect_type IN ('ticket','comment')",
        undefined,
        'inbound_email_effects_type_check'
      );
    });
    await ensureTenantDistribution(knex, 'inbound_email_effects');
  }

  // -------------------------------------------------------------------------
  // inbound_email_artifacts
  // -------------------------------------------------------------------------
  const hasArtifacts = await knex.schema.hasTable('inbound_email_artifacts');
  if (!hasArtifacts) {
    await knex.schema.createTable('inbound_email_artifacts', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('inbox_id').notNullable();
      table.text('artifact_key').notNullable();
      table.text('artifact_type').notNullable();
      table.text('source_attachment_id').nullable();
      table.text('content_digest').nullable();
      table.text('storage_key').nullable();
      table.text('status').notNullable().defaultTo('pending');
      table.integer('attempt_count').notNullable().defaultTo(0);
      table.text('lease_owner').nullable();
      table.uuid('lease_token').nullable();
      table.bigint('lease_version').notNullable().defaultTo(0);
      table.timestamp('lease_expires_at', { useTz: true }).nullable();
      table.timestamp('next_attempt_at', { useTz: true }).nullable();
      table.uuid('file_id').nullable();
      table.uuid('document_id').nullable();
      table.text('last_error').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('completed_at', { useTz: true }).nullable();

      table.primary(['tenant', 'inbox_id', 'artifact_key']);
      table.foreign(['tenant', 'inbox_id'])
        .references(['tenant', 'inbox_id'])
        .inTable('inbound_email_inbox');
      table.check(
        "artifact_type IN ('attachment','embedded_image','original_email')",
        undefined,
        'inbound_email_artifacts_type_check'
      );
      table.check(
        "status IN ('pending','processing','succeeded','skipped','retryable_failed','terminal_failed')",
        undefined,
        'inbound_email_artifacts_status_check'
      );
      table.check(
        "status <> 'processing' OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)",
        undefined,
        'inbound_email_artifacts_processing_lease_check'
      );
      table.check(
        "status <> 'retryable_failed' OR next_attempt_at IS NOT NULL",
        undefined,
        'inbound_email_artifacts_retryable_next_attempt_check'
      );
      table.check(
        "status NOT IN ('succeeded','skipped','terminal_failed') OR (lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)",
        undefined,
        'inbound_email_artifacts_terminal_lease_check'
      );
      table.check('attempt_count >= 0', undefined, 'inbound_email_artifacts_attempt_count_check');
      table.index(['tenant', 'status', 'next_attempt_at', 'lease_expires_at'], 'inbound_email_artifacts_due_idx');
    });
    await ensureTenantDistribution(knex, 'inbound_email_artifacts');
  }

  // -------------------------------------------------------------------------
  // inbound_email_outbox
  // -------------------------------------------------------------------------
  const hasOutbox = await knex.schema.hasTable('inbound_email_outbox');
  if (!hasOutbox) {
    await knex.schema.createTable('inbound_email_outbox', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('outbox_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('inbox_id').notNullable();
      table.text('event_key').notNullable();
      table.text('event_type').notNullable();
      table.jsonb('payload').notNullable();
      table.jsonb('publish_options').nullable();
      table.text('status').notNullable().defaultTo('pending');
      table.integer('attempt_count').notNullable().defaultTo(0);
      table.text('lease_owner').nullable();
      table.uuid('lease_token').nullable();
      table.bigint('lease_version').notNullable().defaultTo(0);
      table.timestamp('lease_expires_at', { useTz: true }).nullable();
      table.timestamp('next_attempt_at', { useTz: true }).nullable();
      table.timestamp('published_at', { useTz: true }).nullable();
      table.text('last_error').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'outbox_id']);
      table.unique(['tenant', 'inbox_id', 'event_key'], 'inbound_email_outbox_event_key_unique');
      table.foreign(['tenant', 'inbox_id'])
        .references(['tenant', 'inbox_id'])
        .inTable('inbound_email_inbox');
      table.check(
        "status IN ('pending','publishing','published','retryable_failed','terminal_failed')",
        undefined,
        'inbound_email_outbox_status_check'
      );
      table.check(
        "status <> 'publishing' OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)",
        undefined,
        'inbound_email_outbox_publishing_lease_check'
      );
      table.check(
        "status <> 'retryable_failed' OR next_attempt_at IS NOT NULL",
        undefined,
        'inbound_email_outbox_retryable_next_attempt_check'
      );
      table.check(
        "status NOT IN ('published','terminal_failed') OR (lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)",
        undefined,
        'inbound_email_outbox_terminal_lease_check'
      );
      table.check(
        "status <> 'published' OR published_at IS NOT NULL",
        undefined,
        'inbound_email_outbox_published_at_check'
      );
      table.check('attempt_count >= 0', undefined, 'inbound_email_outbox_attempt_count_check');
      table.index(['tenant', 'status', 'next_attempt_at', 'lease_expires_at'], 'inbound_email_outbox_due_idx');
    });
    await ensureTenantDistribution(knex, 'inbound_email_outbox');
  }
};

/**
 * Local/test-only rollback: drop the new tables child-first. Production
 * rollback must keep populated durable tables in place (see plan rollback).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('inbound_email_outbox');
  await knex.schema.dropTableIfExists('inbound_email_artifacts');
  await knex.schema.dropTableIfExists('inbound_email_effects');
  await knex.schema.dropTableIfExists('inbound_email_inbox');
  await knex.schema.dropTableIfExists('inbound_email_ingress');
};

// Disable transaction for Citus DB compatibility (create_distributed_table
// cannot run inside a migration transaction).
exports.config = { transaction: false };
