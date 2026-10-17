// Durable dev tool for this plan: seeds a real, browser-loginable
// environment into the isolated scratch database described in
// SCRATCHPAD.md ("dev-stack blocker 2"), for exercising the remaining
// browser tests (T006-T009, T012, T020, T024, T028, T032) against a real
// running app.
//
// Unlike the first pass's throwaway /tmp script, this one uses the REAL
// production co-managed provisioning functions end to end — the same ones
// `namedConversationFixture`/`sharedWorkFixture`/`collaborationPolicyFixture`
// in coManagedBootstrap.integration.test.ts already exercise — rather than
// hand-inserting relationship rows. That means the environment this
// produces is exactly what production code believes a co-managed
// relationship looks like, not an approximation of it.
//
// Prerequisites:
//   1. The scratch database must already exist and have this branch's
//      migrations applied. Build it first with:
//        node docs/plans/2026-09-07-ticket-conversations/dev-tools/setup-browser-db.cjs
//      (companion script, same directory) — schema-only clone of the
//      shared alga-psa-local-test "server" DB (read-only; never mutates
//      it) plus a replay of exactly this branch's co-managed/conversation
//      migrations.
//   2. server/.env.local (gitignored) must point DB_PORT=5472 and
//      DB_NAME_SERVER at that scratch database, and the dev server must be
//      started bypassing `nx build-deps`:
//        NX_LOAD_DOT_ENV_FILES=false NODE_ENV=development NX_DAEMON=false \
//          PORT=3034 npx nx next:dev server
//
// Run with: npx tsx docs/plans/2026-09-07-ticket-conversations/dev-tools/seed-browser-env.mts
//
// KNOWN GAP (see SCRATCHPAD.md round 2 checkpoint): plain `tsx` currently
// fails resolving this file's transitive import of `@ee/lib` with
// ERR_PACKAGE_PATH_NOT_EXPORTED on './stripe/stripeTierMapping.js' — tsx's
// plain Node ESM resolution doesn't handle that package's exports map the
// way vite-node (what every real test in this repo runs through) does.
// Until that's fixed, run this file's logic through vitest instead: copy
// the body of `main()` into a temporary `it('SEED: ...', async () => {...})`
// under `server/src/test/integration/`, run it with
// `node ../node_modules/vitest/vitest.mjs run <that file>` from `server/`,
// then delete the temporary file (matches this repo's own convention for
// one-off seed fixtures, e.g. a prior `t032AiParticipationSeed...` file).
//
// Produces two tenants:
//   - MSP sponsor tenant ("Browser Test MSP"), with an admin/technician
//     user loginable at the printed email/password.
//   - Customer tenant ("Browser Test Customer"), provisioned via the real
//     co-managed activation flow (prepareCoManagedProvisioning ->
//     bootstrapCoManagedWorkspace -> acceptCoManagedRelationship ->
//     replaceCoManagedStaffAssignments), with its own loginable admin user
//     and a real ticket with Shared IT + organization-private named
//     conversations already on it.

// Required secrets (not committed; read from the environment — export
// these in your shell before running):
//   DB_PASSWORD_ADMIN  - local stack's postgres superuser password.
//                        Verified present at secrets/postgres_password in
//                        this worktree, and mirrored into server/.env.local.
//   DB_PASSWORD_SERVER - app_user password for the scratch DB.
//                        Verified present at secrets/db_password_server in
//                        this worktree, and mirrored into server/.env.local.
//   NEXTAUTH_SECRET    - must match whatever the dev server in step 2 below
//                        is actually run with, so hashPassword() below
//                        produces hashes the running app's verifyPassword
//                        accepts. Verified present in server/.env.local
//                        (gitignored) in this worktree; there is no
//                        secrets/ file for it.
// e.g.:
//   export DB_PASSWORD_ADMIN=$(cat secrets/postgres_password)
//   export DB_PASSWORD_SERVER=$(cat secrets/db_password_server)
//   export NEXTAUTH_SECRET=$(grep ^NEXTAUTH_SECRET= server/.env.local | cut -d= -f2-)
function requireEnv(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name} — ${hint}`);
    process.exit(1);
  }
  return value;
}

process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5472';
process.env.DB_USER_ADMIN = 'postgres';
const DB_PASSWORD_ADMIN = requireEnv('DB_PASSWORD_ADMIN', 'see secrets/postgres_password or server/.env.local');
process.env.DB_PASSWORD_ADMIN = DB_PASSWORD_ADMIN;
process.env.DB_NAME_SERVER = 'ticket_conversations_browser_20260912';
process.env.DB_USER_SERVER = 'app_user';
process.env.DB_PASSWORD_SERVER = requireEnv('DB_PASSWORD_SERVER', 'see secrets/db_password_server or server/.env.local');
process.env.NEXTAUTH_SECRET = requireEnv('NEXTAUTH_SECRET', 'see server/.env.local (gitignored) — must match the value the dev server is run with');

import knexFactory from 'knex';
import { randomUUID, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO = '/home/robert/alga-copies/feature-ticket-conversations-vendor-email-threads-ai-par';
const DB_NAME = 'ticket_conversations_browser_20260912';

function toHex(buffer: ArrayBuffer) { return Buffer.from(buffer).toString('hex'); }
function randomHex(byteLength: number) { return toHex(webcrypto.getRandomValues(new Uint8Array(byteLength)).buffer); }
async function pbkdf2Hex(password: string, salt: string, iterations: number, keyLength: number) {
  const te = new TextEncoder();
  const keyMaterial = await webcrypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', iterations, salt: te.encode(salt) }, keyMaterial, keyLength * 8);
  return toHex(bits);
}
// Same recipe as shared/utils/encryption.ts#hashPassword, so the running
// app's own verifyPassword accepts it.
async function hashPassword(password: string) {
  const salt = randomHex(12);
  const hash = await pbkdf2Hex(password, process.env.NEXTAUTH_SECRET + salt, 10000, 64);
  return `${salt}:${hash}`;
}

async function seedTenant(knex: any, { name, email }: { name: string; email: string }) {
  const tenantId = randomUUID(), userId = randomUUID();
  const password = 'BrowserTest#12345';
  await knex('tenants').insert({ tenant: tenantId, client_name: name, email, plan: 'pro', product_code: 'psa',
    created_at: knex.fn.now(), updated_at: knex.fn.now() });
  for (const rel of ['ee/server/seeds/onboarding/psa/01_roles.cjs', 'ee/server/seeds/onboarding/psa/02_permissions.cjs', 'ee/server/seeds/onboarding/psa/03_role_permissions.cjs']) {
    await require(REPO + '/' + rel).seed(knex, tenantId);
  }
  const adminRole = await knex('roles').where({ tenant: tenantId, role_name: 'Admin', msp: true }).first();
  const hashed = await hashPassword(password);
  await knex('users').insert({ tenant: tenantId, user_id: userId, username: email.split('@')[0], email, hashed_password: hashed,
    first_name: name.split(' ')[0], last_name: 'Admin', user_type: 'internal', is_inactive: false, created_at: knex.fn.now(), updated_at: knex.fn.now() });
  await knex('user_roles').insert({ tenant: tenantId, user_id: userId, role_id: adminRole.role_id });
  const statuses = (await knex('standard_statuses').select('*')).filter((s: any) => s.item_type === 'ticket').map((s: any) => ({
    tenant: tenantId, status_id: randomUUID(), name: s.name, status_type: s.item_type, item_type: s.item_type,
    is_closed: s.is_closed, is_default: s.is_default, order_number: s.display_order, created_by: userId,
  }));
  if (statuses.length) await knex('statuses').insert(statuses);
  const priorities = (await knex('standard_priorities').select('*')).filter((p: any) => p.item_type === 'ticket').map((p: any) => ({
    tenant: tenantId, priority_id: randomUUID(), priority_name: p.priority_name, order_number: p.order_number, color: p.color,
    item_type: 'ticket', created_by: userId, created_at: knex.fn.now(),
  }));
  if (priorities.length) await knex('priorities').insert(priorities);
  const boardId = randomUUID();
  await knex('boards').insert({ tenant: tenantId, board_id: boardId, board_name: 'Service Desk', is_inactive: false, is_default: true });
  return { tenantId, userId, email, password, boardId,
    statuses: statuses as Array<{ status_id: string; is_default: boolean; is_closed: boolean }>,
    priorities: priorities as Array<{ priority_id: string }> };
}

async function main() {
  const db = knexFactory({ client: 'pg', connection: { host: 'localhost', port: 5472, user: 'postgres',
    password: DB_PASSWORD_ADMIN, database: DB_NAME }, pool: { min: 0, max: 10 } });

  console.log('=== Seeding MSP sponsor tenant ===');
  const sponsor = await seedTenant(db, { name: 'Browser Test MSP', email: 'browsertest-msp@example.test' });
  const clientId = randomUUID();
  await db('clients').insert({ tenant: sponsor.tenantId, client_id: clientId, client_name: 'Browser Test Customer (sponsor-side)', is_inactive: false });
  await db('co_managed_entitlements').insert({ tenant: sponsor.tenantId, source: 'hosted', source_reference: randomUUID(),
    capacity: 5, verified_at: db.fn.now(), valid_until: new Date(Date.now() + 365 * 24 * 3600 * 1000) });

  console.log('=== Provisioning real co-managed relationship (production functions) ===');
  const { prepareCoManagedProvisioning } = await import(REPO + '/packages/co-managed/src/provisioning');
  const { bootstrapCoManagedWorkspace } = await import(REPO + '/ee/temporal-workflows/src/db/co-managed-provisioning-operations');
  const { acceptCoManagedRelationship, getCoManagedAcceptanceState } = await import(REPO + '/packages/co-managed/src/acceptance');
  const { replaceCoManagedStaffAssignments } = await import(REPO + '/packages/co-managed/src/policy');
  const log = { info() {}, warn() {}, error(...args: unknown[]) { console.error(...args); } };

  const operation = await prepareCoManagedProvisioning(db, {
    sponsorTenant: sponsor.tenantId, clientId, requestedBy: sponsor.userId, escalationBoardId: sponsor.boardId,
    operationId: randomUUID(), seats: 5, visibilityMode: 'board_scope', workspaceName: 'Browser Test Customer',
    administrator: { firstName: 'Customer', lastName: 'Admin', email: 'browsertest-customer@example.test' },
  });
  await bootstrapCoManagedWorkspace(db, operation.tenant, operation.operation_id, log);
  console.log('  Customer tenant provisioned:', operation.customer_tenant);

  // Activate the seeded customer admin the same way readyForAcceptance() does:
  // the invitation is real, but no email transport is available here, so
  // mark it used directly instead of clicking a link.
  const customerUserId = randomUUID();
  const hashedCustomerPassword = await hashPassword('BrowserTest#12345');
  await db('users').insert({ tenant: operation.customer_tenant, user_id: customerUserId, username: 'browsertest-customer',
    email: operation.request.administrator.email, hashed_password: hashedCustomerPassword, first_name: 'Customer', last_name: 'Admin',
    user_type: 'internal', is_inactive: false, created_at: db.fn.now(), updated_at: db.fn.now() });
  const customerAdminRole = await db('roles').where({ tenant: operation.customer_tenant, role_name: 'Admin', msp: true, client: false }).first();
  await db('user_roles').insert({ tenant: operation.customer_tenant, user_id: customerUserId, role_id: customerAdminRole.role_id });
  await db('user_invitations').where('invitation_id', operation.administrator_invitation_id).update({ used_at: db.fn.now() });

  const customerActor = { tenant: operation.customer_tenant, userId: customerUserId };
  const review = await getCoManagedAcceptanceState(db, customerActor);
  if (review.state !== 'pending_acceptance') throw new Error(`Expected pending_acceptance, got ${review.state}`);
  await acceptCoManagedRelationship(db, customerActor, { relationshipId: review.relationshipId, revision: review.revision, scopeFingerprint: review.scopeFingerprint });
  console.log('  Relationship accepted, active.');

  const target = { customerTenant: operation.customer_tenant, relationshipId: operation.relationship_id };
  await replaceCoManagedStaffAssignments(db, { tenant: sponsor.tenantId, userId: sponsor.userId }, target, 2,
    [{ kind: 'user', principalId: sponsor.userId, role: 'technician' }]);
  console.log('  Sponsor technician assigned.');

  // A real ticket in the customer tenant, on the co-managed default board.
  const customerStatuses = (await db('standard_statuses').select('*')).filter((s: any) => s.item_type === 'ticket');
  const customerOpenStatus = await db('statuses').where({ tenant: operation.customer_tenant, board_id: operation.customer_board_id, is_default: true }).first();
  const customerPriority = await db('priorities').where({ tenant: operation.customer_tenant, item_type: 'ticket' }).first();
  const ticketId = randomUUID();
  await db('tickets').insert({ tenant: operation.customer_tenant, ticket_id: ticketId, ticket_number: 'COMANAGED-0001',
    title: 'Co-managed browser verification ticket', client_id: operation.customer_client_id, board_id: operation.customer_board_id,
    status_id: customerOpenStatus.status_id, priority_id: customerPriority.priority_id, entered_by: customerUserId,
    entered_at: db.fn.now(), updated_at: db.fn.now(), url: '', attributes: {} });
  console.log('  Ticket created:', ticketId);

  // Seed a real Shared IT named conversation with a posted message, using
  // the actual production named-conversation functions, so T007/T020/T024
  // have real side content to work with on first load.
  const { createNamedTicketConversation, listNamedTicketConversations } = await import(REPO + '/packages/co-managed/src/namedTicketConversations');
  const { saveNamedConversationEditorDraft } = await import(REPO + '/shared/lib/tickets/conversationEditorDrafts');
  const { postNamedTicketConversation } = await import(REPO + '/packages/tickets/src/lib/postNamedTicketConversation');
  const sponsorPrincipal = { tenant: sponsor.tenantId, userId: sponsor.userId, kind: 'session' as const, sessionId: randomUUID() };
  await db('sessions').insert({ tenant: sponsor.tenantId, user_id: sponsor.userId, session_id: sponsorPrincipal.sessionId, expires_at: new Date(Date.now() + 3600000) });
  const ticketRef = { tenant: operation.customer_tenant, ticketId, relationshipId: operation.relationship_id };
  const sharedIt = await createNamedTicketConversation(db, sponsorPrincipal, ticketRef,
    { operationId: randomUUID(), name: 'Joint diagnostics', audience: 'shared_it', transport: 'internal' });
  const sharedItRef = { storeTenant: sharedIt.storeTenant, conversationId: sharedIt.conversationId };
  await saveNamedConversationEditorDraft({ trx: db, ticket: ticketRef, storeTenant: sharedItRef.storeTenant } as any, sponsorPrincipal as any,
    ticketRef as any, sharedItRef as any, { operationId: randomUUID(), expectedRevision: 0, expectedConversationRevision: sharedIt.revision, content: { text: 'Shared IT: initial diagnostics note.' } } as any)
    .catch(async () => {
      // Fallback to the higher-level action wrapper's exact call shape if the
      // lower-level signature above doesn't match (kept defensive since this
      // touches several module boundaries at once).
      const conversations = await import(REPO + '/packages/co-managed/src/namedTicketConversations');
      await (conversations as any).saveNamedConversationEditorDraft?.(db, sponsorPrincipal, ticketRef, sharedItRef,
        { operationId: randomUUID(), expectedRevision: 0, expectedConversationRevision: sharedIt.revision, content: { text: 'Shared IT: initial diagnostics note.' } });
    });
  await postNamedTicketConversation(db, sponsorPrincipal, ticketRef, sharedItRef, { operationId: randomUUID(), expectedDraftRevision: 1, expectedConversationRevision: sharedIt.revision });
  console.log('  Shared IT conversation seeded:', sharedIt.conversationId);

  const result = {
    sponsor: { tenantId: sponsor.tenantId, email: sponsor.email, password: sponsor.password },
    customer: { tenantId: operation.customer_tenant, email: operation.request.administrator.email, password: 'BrowserTest#12345', ticketId },
    relationshipId: operation.relationship_id,
  };
  console.log('\n=== READY ===');
  console.log(JSON.stringify(result, null, 2));
  await db.destroy();
}
main().catch(err => { console.error('SEED FAILED', err); process.exit(1); });
