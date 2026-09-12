// Durable dev tool for this plan (see SCRATCHPAD.md, "dev-stack blocker 2").
//
// Builds an isolated scratch database for real browser testing of this
// branch, using the exact recipe coManagedBootstrap.integration.test.ts's
// own `beforeAll` already uses successfully: a schema-only, read-only
// pg_dump clone of the shared alga-psa-local-test "server" database (never
// mutated) plus a hardcoded replay of exactly this branch's co-managed and
// ticket-conversation migrations. This does NOT use `knex migrate:latest` —
// the shared DB's migration ledger references migration files that don't
// exist in this worktree (other worktrees have advanced it along a
// different, incompatible lineage), so `migrate:latest`/`migrate:status`
// refuse outright with "the migration directory is corrupt".
//
// Run with: node docs/plans/2026-09-07-ticket-conversations/dev-tools/setup-browser-db.cjs
// Then point server/.env.local (gitignored) at the resulting database:
//   DB_PORT=5472
//   DB_NAME_SERVER=ticket_conversations_browser_20260912
// (port 5472 is the real Postgres port; PgBouncer on 6472 does not route to
// dynamically-created databases, only the ones in its static config)
// and start the dev server bypassing `nx build-deps` (see SCRATCHPAD.md,
// "dev-stack blocker 1"):
//   NX_LOAD_DOT_ENV_FILES=false NODE_ENV=development NX_DAEMON=false \
//     PORT=3034 npx nx next:dev server
//
// Follow with dev-tools/seed-browser-env.mts to populate a real,
// browser-loginable tenant (or two, with a real co-managed relationship)
// into the database this script creates.
//
// Required secret (not committed; read from the environment — export it in
// your shell before running):
//   DB_PASSWORD_ADMIN - local stack's postgres superuser password. Verified
//                       present at secrets/postgres_password in this
//                       worktree, and mirrored into server/.env.local.
// e.g.:
//   export DB_PASSWORD_ADMIN=$(cat secrets/postgres_password)
const knex = require('/home/robert/alga-copies/feature-ticket-conversations-vendor-email-threads-ai-par/node_modules/knex');
const { execFileSync } = require('node:child_process');

function requireEnv(name, hint) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name} — ${hint}`);
    process.exit(1);
  }
  return value;
}

const DB_NAME = 'ticket_conversations_browser_20260912';
const MIGRATIONS_DIR = '/home/robert/alga-copies/feature-ticket-conversations-vendor-email-threads-ai-par/server/migrations/';

const connection = { host: 'localhost', port: 5472, user: 'postgres',
  password: requireEnv('DB_PASSWORD_ADMIN', 'see secrets/postgres_password or server/.env.local') };
const sourceDatabase = 'server';

// Exactly this branch's co-managed/ticket-conversation migrations, in
// order. Cross-checked against `server/migrations/` at HEAD when this
// script was written; if new co-managed/conversation migrations land,
// append them here in filename order.
const MIGRATION_FILES = [
  '20260906010000_create_co_management_foundation.cjs',
  '20260906020000_add_co_managed_entitlement_source_version.cjs',
  '20260906030000_create_co_managed_purchase_operations.cjs', '20260906040000_create_co_managed_provisioning.cjs',
  '20260906050000_allow_system_seeded_priorities.cjs', '20260906060000_create_co_managed_board_scopes.cjs', '20260906070000_add_co_managed_invitation_delivery.cjs',
  '20260906080000_create_co_management_relationship_events.cjs',
  '20260906100000_add_external_file_metadata.cjs',
  '20260906110000_add_kb_import_batch_identity.cjs',
  '20260906120000_create_co_management_collaboration_policy.cjs', '20260906130000_create_co_management_ticket_handoffs.cjs', '20260906140000_create_collaboration_actor_references.cjs', '20260906150000_create_co_management_command_receipts.cjs', '20260906160000_create_co_management_content_audiences.cjs', '20260906170000_create_co_management_private_command_receipts.cjs', '20260906180000_create_co_management_in_app_receipts.cjs', '20260906190000_create_co_management_notification_deliveries.cjs', '20260906200000_create_co_management_conversation_attachments.cjs', '20260906210000_create_co_management_conversation_drafts.cjs', '20260906220000_add_co_managed_upload_cleanup.cjs', '20260906230000_add_co_managed_attachment_removal.cjs', '20260907000000_create_co_management_thread_transfers.cjs', '20260907010000_create_co_management_event_outbox.cjs', '20260907020000_create_co_management_event_consumers.cjs', '20260907030000_create_co_management_email_deliveries.cjs', '20260907040000_create_co_management_customer_email_deliveries.cjs', '20260907050000_create_co_management_requester_reply_tokens.cjs', '20260907060000_create_co_management_requester_email_deliveries.cjs', '20260907070000_add_co_management_requester_email_consumer.cjs', '20260907080000_create_co_management_customer_reply_tokens.cjs', '20260907122957_create_co_management_inbound_reply_receipts.cjs', '20260907124147_link_inbound_artifacts_to_conversation_attachments.cjs', '20260907135115_add_scheduled_comment_recovery.cjs', '20260907150600_preserve_explicit_audit_tenant.cjs', '20260907154500_create_co_managed_task_references.cjs', '20260907163000_add_project_task_collaboration_comments.cjs', '20260907171500_qualify_co_managed_conversation_events.cjs', '20260907183000_qualify_co_managed_notification_receipts.cjs', '20260907190000_qualify_co_managed_email_deliveries.cjs', '20260907192000_preserve_operational_time_entries.cjs', '20260907210000_create_native_time_tracking_sessions.cjs', '20260907233000_add_time_sheet_notes.cjs', '20260907234500_create_time_period_calendar_locks.cjs', '20260908013607_create_named_ticket_conversations.cjs', '20260908015652_create_ticket_conversation_editor_drafts.cjs', '20260908022249_scope_ticket_conversation_defaults_to_relationship.cjs', '20260908024119_create_ticket_conversation_publications.cjs', '20260908030840_retain_ticket_conversation_draft_reply_target.cjs', '20260908033011_create_ticket_conversation_sender_grants.cjs', '20260908034701_create_ticket_conversation_email_operations.cjs', '20260908042702_create_ticket_conversation_inbound_receipts.cjs', '20260908045632_track_named_conversation_correspondents.cjs', '20260908051006_retain_named_reply_review_resolutions.cjs', '20260908052731_extend_conversation_files_to_native_vendor_replies.cjs', '20260908054601_retain_named_editor_file_bindings.cjs', '20260908060651_retain_named_file_publication_operations.cjs', '20260908091259_retain_named_requester_publication_options.cjs', '20260908094308_retain_named_requester_close_intent.cjs', '20260908101532_retain_named_email_recovery_due.cjs', '20260908102605_retain_named_requester_schedule_intent.cjs', '20260908115747_create_ticket_conversation_attention.cjs', '20260908122807_retain_named_conversation_notification_receipts.cjs', '20260908125648_retain_named_conversation_email_notifications.cjs', '20260908133439_retain_native_ticket_email_recipient_policy.cjs', '20260908152720_retain_ticket_conversation_share_lineage.cjs', '20260908165830_retain_ticket_conversation_ai_runs.cjs', '20260908191034_retain_ticket_conversation_ai_participation.cjs', '20260909100000_add_inbound_reply_reopen_side_conversations_to_boards.cjs',
];

async function main() {
  const admin = knex({ client: 'pg', connection: { ...connection, database: 'postgres' } });
  console.log('Dropping scratch DB if present...');
  await admin.raw('DROP DATABASE IF EXISTS ??', [DB_NAME]);
  console.log('Creating scratch DB', DB_NAME);
  await admin.raw('CREATE DATABASE ??', [DB_NAME]);

  const env = { ...process.env, PGHOST: connection.host, PGPORT: String(connection.port), PGUSER: connection.user, PGPASSWORD: connection.password };
  console.log('pg_dump schema-only from', sourceDatabase, '(read-only; the shared DB is never written to)...');
  const schema = execFileSync('pg_dump', ['--schema-only', '--no-owner', '--no-privileges', '--dbname', sourceDatabase],
    { env, maxBuffer: 200 * 1024 * 1024, timeout: 120000 });
  console.log('Restoring schema into scratch DB...');
  execFileSync('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--quiet', '--dbname', DB_NAME],
    // Newer pg_dump clients emit this session setting even for older PG
    // servers; strip it so replay works against this server's version.
    { env, input: schema.toString().replace(/^SET transaction_timeout = 0;\r?\n/m, ''), maxBuffer: 200 * 1024 * 1024, timeout: 120000 });

  const db = knex({ client: 'pg', connection: { ...connection, database: DB_NAME }, pool: { min: 0, max: 6 } });
  console.log('GRANT ALL ON SCHEMA public TO app_user (pg_dump --no-privileges strips it — the app cannot connect without this)...');
  await db.raw('GRANT ALL ON SCHEMA public TO app_user');
  await db.raw('GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user');
  await db.raw('GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_user');
  await db.raw('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user');
  await db.raw('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_user');

  console.log('Replaying', MIGRATION_FILES.length, 'co-managed/conversation migrations...');
  for (const file of MIGRATION_FILES) {
    process.stdout.write('  ' + file + '... ');
    await require(MIGRATIONS_DIR + file).up(db);
    console.log('ok');
  }

  console.log('Copying reference tables...');
  const source = knex({ client: 'pg', connection: { ...connection, database: sourceDatabase } });
  for (const table of ['standard_statuses', 'standard_priorities', 'countries', 'notification_categories',
    'notification_subtypes', 'internal_notification_categories', 'internal_notification_subtypes']) {
    const rows = await source(table).select('*');
    if (rows.length) await db.batchInsert(table, rows, 100);
    console.log('  ', table, rows.length, 'rows');
  }

  await db.destroy(); await source.destroy(); await admin.destroy();
  console.log('DONE. Database ready:', DB_NAME);
}
main().catch(err => { console.error('FAILED', err); process.exit(1); });
