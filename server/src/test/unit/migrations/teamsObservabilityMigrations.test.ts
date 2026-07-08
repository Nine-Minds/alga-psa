import { describe, expect, it } from 'vitest';
import path from 'path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('teams observability migrations', () => {
  const deliveriesMigration = readRepoFile('ee/server/migrations/20260524090000_create_teams_notification_deliveries.cjs');
  const auditMigration = readRepoFile('ee/server/migrations/20260524090100_create_teams_audit_events.cjs');
  const conversationsMigration = readRepoFile('ee/server/migrations/20260524090200_create_teams_conversation_references.cjs');

  it('creates the Teams notification deliveries table with the expected columns and constraints', () => {
    expect(deliveriesMigration).toContain('CREATE TABLE IF NOT EXISTS teams_notification_deliveries');
    expect(deliveriesMigration).toContain('tenant uuid NOT NULL');
    expect(deliveriesMigration).toContain('delivery_id uuid NOT NULL DEFAULT gen_random_uuid()');
    expect(deliveriesMigration).toContain('internal_notification_id uuid');
    expect(deliveriesMigration).toContain('destination_type text NOT NULL');
    expect(deliveriesMigration).toContain('destination_id text NOT NULL');
    expect(deliveriesMigration).toContain('attempt_number integer NOT NULL DEFAULT 1');
    expect(deliveriesMigration).toContain('provider_message_id text');
    expect(deliveriesMigration).toContain('provider_request_id text');
    expect(deliveriesMigration).toContain('CONSTRAINT teams_notification_deliveries_status_check');
    expect(deliveriesMigration).toContain("status IN ('skipped', 'sent', 'delivered', 'failed')");
    expect(deliveriesMigration).toContain('CONSTRAINT teams_notification_deliveries_error_code_check');
    expect(deliveriesMigration).toContain('graph_throttled');
    expect(deliveriesMigration).toContain('CONSTRAINT teams_notification_deliveries_pk PRIMARY KEY (tenant, delivery_id)');
    expect(deliveriesMigration).toContain('CONSTRAINT teams_notification_deliveries_idempotency_uk UNIQUE (tenant, idempotency_key)');
    expect(deliveriesMigration).not.toContain('PARTITION BY RANGE');
    expect(deliveriesMigration).not.toContain('CREATE TABLE IF NOT EXISTS teams_notification_delivery_idempotency');
  });

  it('creates delivery indexes and Citus distribution hooks', () => {
    expect(deliveriesMigration).toContain('teams_notification_deliveries_internal_notification_idx');
    expect(deliveriesMigration).toContain('ON teams_notification_deliveries (tenant, internal_notification_id)');
    expect(deliveriesMigration).toContain('teams_notification_deliveries_status_created_idx');
    expect(deliveriesMigration).toContain('ON teams_notification_deliveries (tenant, status, created_at DESC)');
    expect(deliveriesMigration).toContain("create_distributed_table(?, 'tenant', colocate_with => 'teams_integrations')");
    expect(deliveriesMigration).toContain('Citus distribution smoke count');
    expect(deliveriesMigration).toContain('exports.config = { transaction: false }');
  });

  it('defines cleanup functions with safe retention cutoffs for deliveries and audit events', () => {
    expect(deliveriesMigration).toContain("cleanup_teams_notification_deliveries(retention_interval interval DEFAULT interval '90 days')");
    expect(deliveriesMigration).toContain('DELETE FROM teams_notification_deliveries');
    expect(deliveriesMigration).toContain('WHERE created_at < now() - retention_interval');
    expect(deliveriesMigration).toContain('GET DIAGNOSTICS deleted_count = ROW_COUNT');

    expect(auditMigration).toContain("retention_interval interval DEFAULT interval '365 days'");
    expect(auditMigration).toContain('DELETE FROM teams_audit_events');
    expect(auditMigration).toContain('WHERE created_at < now() - retention_interval');
    expect(auditMigration).toContain('GET DIAGNOSTICS deleted_count = ROW_COUNT');
  });

  it('creates the Teams audit events table with constrained surfaces, actions, statuses, indexes, and cleanup', () => {
    expect(auditMigration).toContain('CREATE TABLE IF NOT EXISTS teams_audit_events');
    expect(auditMigration).toContain('CONSTRAINT teams_audit_events_pk PRIMARY KEY (tenant, event_id)');
    expect(auditMigration).toContain("surface IN ('bot', 'message_extension', 'quick_action', 'tab')");
    expect(auditMigration).toContain("result_status IN ('success', 'failure')");
    for (const actionId of [
      'assign_ticket',
      'add_note',
      'reply_to_contact',
      'log_time',
      'approval_response',
      'create_ticket_from_message',
      'update_from_message',
    ]) {
      expect(auditMigration).toContain(actionId);
    }
    expect(auditMigration).toContain('teams_audit_events_actor_created_idx');
    expect(auditMigration).toContain('teams_audit_events_target_idx');
    expect(auditMigration).toContain("cleanup_teams_audit_events(retention_interval interval DEFAULT interval '365 days')");
    expect(auditMigration).toContain("create_distributed_table(?, 'tenant', colocate_with => 'teams_integrations')");
  });

  it('creates the Teams conversation references table with tenant-scoped primary key and Citus distribution', () => {
    expect(conversationsMigration).toContain('CREATE TABLE IF NOT EXISTS teams_conversation_references');
    expect(conversationsMigration).toContain('microsoft_user_id text NOT NULL');
    expect(conversationsMigration).toContain('conversation_id text NOT NULL');
    expect(conversationsMigration).toContain('conversation_type text NOT NULL');
    expect(conversationsMigration).toContain('service_url text NOT NULL');
    expect(conversationsMigration).toContain('tenant_id_aad text');
    expect(conversationsMigration).toContain('channel_id_bot_framework text');
    expect(conversationsMigration).toContain('last_activity_at timestamptz NOT NULL');
    expect(conversationsMigration).toContain('CONSTRAINT teams_conversation_references_pk PRIMARY KEY (tenant, microsoft_user_id, conversation_id)');
    expect(conversationsMigration).toContain("create_distributed_table(?, 'tenant', colocate_with => 'teams_integrations')");
  });

  it('keeps the observability migrations in the CE migration path without Citus-only mirrors', () => {
    const repoRoot = path.resolve(__dirname, '../../../../..');
    // The citus folder was dead tooling and has been removed; its absence is
    // the strongest form of "no Citus-only mirrors".
    const citusDir = path.join(repoRoot, 'ee/server/migrations/citus');
    const citusMigrationNames = existsSync(citusDir) ? readdirSync(citusDir) : [];
    expect(citusMigrationNames).not.toContain('20260524090000_create_teams_notification_deliveries.cjs');
    expect(citusMigrationNames).not.toContain('20260524090100_create_teams_audit_events.cjs');
    expect(citusMigrationNames).not.toContain('20260524090200_create_teams_conversation_references.cjs');
  });
});
