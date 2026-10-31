import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareUpgradeSchema } from '../../../../../scripts/lib/upgrade-schema-source.mjs';
import type { Knex } from 'knex';
import { runWithTenant, tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../../server/test-utils/dbConfig';
import { bootstrapCoManagedCustomer } from '../../activities/co-managed-provisioning-activities';
import { acceptCoManagedRelationship, getCoManagedAcceptanceState } from '../../../../../packages/co-managed/src/acceptance';
import { replaceCoManagedCustomerScope, replaceCoManagedStaffAssignments, getCoManagedCollaborationPolicy,
  listCoManagedLiveSponsoredRelationships, CoManagedPolicyError,
  type CoManagedPolicyTarget } from '../../../../../packages/co-managed/src/policy';
import { withCoManagedSharedWork, CoManagedSharedWorkError } from '../../../../../packages/co-managed/src/sharedWork';
import { getCoManagedSharedWorkSummary, listCoManagedCustomerTickets } from '../../../../../packages/co-managed/src/sharedWorkRead';
import { saveCoManagedDelegatedGrant, revokeCoManagedDelegatedGrant, executeCoManagedDelegatedCommand, getCoManagedDelegatedScreen,
  coManagedDelegatedReceipts, CoManagedDelegationError } from '../../../../../packages/co-managed/src/delegatedAdministration';
import { prepareNativeAccessOperation } from './helpers/coManagedFixtures';
import '../../../../../packages/co-managed/src/capability';
import { registerFeatureFlagChecker } from '../../../../../packages/core/src/lib/features';
import { clearCapabilityCache } from '../../../../../packages/core/src/capability/testing';

// Same substitutions as coManagedProvisioning.integration.test.ts: transport and framework seams only.
// No authentication, permission, lifecycle or policy function is replaced.
const delivery = vi.hoisted(() => ({ send: vi.fn() }));
const actorState = vi.hoisted(() => ({ user: null as any, session: null as any }));
const flag = vi.hoisted(() => ({ on: true }));
const admission = vi.hoisted(() => ({ fn: null as any }));
vi.mock('../../../../../server/src/lib/co-managed/admitSponsor', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../../server/src/lib/co-managed/admitSponsor')>();
  admission.fn = vi.fn(actual.admitCoManagedSponsor);
  return { ...actual, admitCoManagedSponsor: admission.fn };
});
const appliance = vi.hoisted(() => ({ check: vi.fn(async () => ({ seats: 0 })) }));
vi.mock('@alga-psa/db', async importOriginal => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return { ...actual, getAdminConnection: async () => db, getConnection: async () => db,
    createTenantKnex: async (tenant?: string) => ({ knex: db, tenant: tenant ?? actual.getTenantContext() }) };
});
vi.mock('@alga-psa/auth', async () => ({
  withAuth: (handler: any) => (...args: any[]) => handler(actorState.user, { tenant: actorState.user.tenant }, ...args),
  hasPermission: async (...args: Parameters<typeof import('../../../../../packages/auth/src/lib/rbac').hasPermission>) =>
    (await import('../../../../../packages/auth/src/lib/rbac')).hasPermission(...args),
  checkMultiplePermissions: async (...args: Parameters<typeof import('../../../../../packages/auth/src/lib/rbac').checkMultiplePermissions>) =>
    (await import('../../../../../packages/auth/src/lib/rbac')).checkMultiplePermissions(...args),
  shouldTouchApiKeyLastUsed: (await import('../../../../../packages/auth/src/services/apiKeyService')).shouldTouchApiKeyLastUsed,
  checkPortalInvitationLimit: async () => ({ success: true }), formatRateLimitError: async () => 'Rate limited',
  verifyAuthenticator: async () => false,
  getSession: async () => actorState.session, getApiKeyUserOverride: () => null,
}));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: async () => actorState.user }));
vi.mock('@alga-psa/user-composition/lib/permissions', () => ({ hasPermission: async () => true }));
vi.mock('@enterprise/lib/license/userSeatGuard', () => ({ checkApplianceLicenseSeatLimit: appliance.check }));
vi.mock('@temporalio/activity', async importOriginal => ({
  ...(await importOriginal<typeof import('@temporalio/activity')>()),
  Context: { current: () => ({ log: { info() {}, warn() {}, error() {} } }) },
}));
vi.mock('@alga-psa/email', () => ({ sendTeamInvitationEmail: delivery.send,
  TenantEmailService: { getInstance: () => ({ isConfigured: async () => true }) }, getSystemEmailService: async () => ({ isConfigured: async () => true }) }));
vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: async () => db,
  withAdminTransactionRetryReadOnly: (work: (trx: Knex.Transaction) => Promise<unknown>) => db.transaction(work),
}));

let db: Knex;
let migrationWork: string;
const databaseName = `co_managed_l2_${randomUUID().replaceAll('-', '')}`.slice(0, 60);

beforeAll(async () => {
  const inheritedDbPort = process.env.DB_PORT; // CI's DB env, before the local wiring overwrites it
  wireLocalTestDbEnv();
  // wireLocalTestDbEnv hardcodes 5472; locally set CO_MANAGED_TEST_DB_PORT=5474 for the card database. CI's DB_PORT is respected.
  process.env.DB_PORT = process.env.CO_MANAGED_TEST_DB_PORT ?? inheritedDbPort ?? '5432';
  process.env.NEXTAUTH_SECRET = 'co-managed-integration-test-secret';
  process.env.CAPABILITY_CACHE_TTL_MS = '0';
  // The real gate, with the release flag as the only seam: eligibility, participation and product code are the real rows.
  registerFeatureFlagChecker(async () => flag.on);
  process.env.NEXT_PUBLIC_BASE_URL = 'https://app.example.test';
  const root = path.resolve(__dirname, '../../../../..');
  migrationWork = mkdtempSync(path.join(tmpdir(), 'co-managed-schema-'));
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const schema = prepareUpgradeSchema({ repository: root, commit, destination: path.join(migrationWork, 'schema'), edition: 'ee' });
  symlinkSync(path.join(root, 'node_modules'), path.join(migrationWork, 'schema', 'node_modules'));
  db = await createTestDbConnection({ databaseName, migrationsDir: schema.directory });
}, 900000);

afterAll(async () => {
  await db?.destroy();
  const { default: knex } = await import('knex');
  const admin = knex({ client: 'pg', connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER_ADMIN, password: process.env.DB_PASSWORD_ADMIN, database: 'postgres' } });
  try {
    await admin.raw('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ? AND pid <> pg_backend_pid()', [databaseName]);
    await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]);
  } finally { await admin.destroy(); if (migrationWork) rmSync(migrationWork, { recursive: true, force: true }); }
});

afterEach(() => { delete process.env.FORCE_CAPABILITIES; flag.on = true; clearCapabilityCache(); });

type Session = { kind: 'session'; tenant: string; userId: string; sessionId: string };

/** A complete accepted relationship built through L1a's provisioning path, plus MSP personas MT/MV/MX. */
async function world() {
  const operation = await prepareNativeAccessOperation(db);
  const sponsorTenant = operation.tenant, customerTenant = operation.customer_tenant, relationshipId = operation.relationship_id;
  await bootstrapCoManagedCustomer({ sponsorTenant, operationId: operation.operation_id });
  const customer = tenantDb(db, customerTenant), sponsor = tenantDb(db, sponsorTenant);
  const invitation = await customer.table('user_invitations').first();
  const { completeUserInvitationSetup } = await import('../../../../../packages/users/src/actions/user-actions/userInvitationActions');
  const signup = await completeUserInvitationSetup(invitation.token, 'ValidPassword!2026');
  if (!signup.success) throw new Error(`Customer administrator setup failed: ${JSON.stringify(signup)}`);
  const session = async (tenant: string, userId: string): Promise<Session> => {
    const sessionId = randomUUID();
    await tenantDb(db, tenant).table('sessions').insert({ tenant, session_id: sessionId, user_id: userId, expires_at: new Date(Date.now() + 3600000) });
    return { kind: 'session', tenant, userId, sessionId };
  };
  const customerAdmin = await session(customerTenant, signup.userId!);
  const review = await getCoManagedAcceptanceState(db, customerAdmin);
  if (review.state !== 'pending_acceptance') throw new Error('No acceptance proposal');
  await acceptCoManagedRelationship(db, customerAdmin, { relationshipId: review.relationshipId, revision: review.revision, scopeFingerprint: review.scopeFingerprint });

  // MSP personas. Home RBAC is identical for all three; only the L2 layers differ.
  const grantRole = async (userId: string, name: string, permissions: Array<[string, string]>) => {
    const roleId = randomUUID();
    await sponsor.table('roles').insert({ tenant: sponsorTenant, role_id: roleId, role_name: `${name} ${roleId}`, description: 'test', msp: true, client: false });
    const ids: Record<string, string> = {};
    for (const [resource, action] of permissions) {
      const permissionId = randomUUID(); ids[`${resource}:${action}`] = permissionId;
      await sponsor.table('permissions').insert({ tenant: sponsorTenant, permission_id: permissionId, resource, action, msp: true, client: false });
      await sponsor.table('role_permissions').insert({ tenant: sponsorTenant, role_id: roleId, permission_id: permissionId });
    }
    await sponsor.table('user_roles').insert({ tenant: sponsorTenant, user_id: userId, role_id: roleId });
    return { roleId, ids };
  };
  const person = async (name: string, permissions: Array<[string, string]>) => {
    const userId = randomUUID();
    await sponsor.table('users').insert({ tenant: sponsorTenant, user_id: userId, username: `${name}-${userId}`, email: `${name}-${userId}@example.test`,
      first_name: name, last_name: 'Tech', hashed_password: 'test-not-a-login', user_type: 'internal', is_inactive: false });
    const granted = await grantRole(userId, name, permissions);
    return { userId, ...granted, actor: await session(sponsorTenant, userId) };
  };
  const work: Array<[string, string]> = [['ticket', 'read'], ['ticket', 'update'], ['ticket_settings', 'read'], ['ticket_settings', 'update'], ['client', 'read']];
  const MT = await person('MT', work), MV = await person('MV', work), MX = await person('MX', work);
  const admin = await session(sponsorTenant, operation.requested_by);
  const manager = await grantRole(operation.requested_by, 'Manager', [['co_management', 'manage'], ['client', 'read']]);
  void manager;

  const target: CoManagedPolicyTarget = { customerTenant, relationshipId };
  const revision = async () => (await getCoManagedCollaborationPolicy(db, customerAdmin, target)).revision;
  await replaceCoManagedStaffAssignments(db, admin, target, await revision(), [
    { kind: 'user', principalId: MT.userId, role: 'technician' }, { kind: 'user', principalId: MV.userId, role: 'viewer' }]);

  const boardId = operation.customer_board_id as string;
  const clientId = randomUUID(), ticketId = randomUUID();
  const status = await customer.table('statuses').where({ item_type: 'ticket', board_id: boardId }).first()
    ?? await customer.table('statuses').where('item_type', 'ticket').first();
  await customer.table('clients').insert({ tenant: customerTenant, client_id: clientId, client_name: 'Native customer' });
  await customer.table('tickets').insert({ tenant: customerTenant, ticket_id: ticketId, title: 'Shared board ticket', ticket_number: `L2-${randomUUID().slice(0, 6)}`,
    client_id: clientId, board_id: boardId, status_id: status.status_id, entered_by: signup.userId, entered_at: new Date() });
  const resource = { tenant: customerTenant, relationshipId, kind: 'ticket' as const, id: ticketId };
  return { operation, sponsorTenant, customerTenant, relationshipId, customerAdmin, admin, MT, MV, MX, target, revision, boardId, ticketId, resource, customer, sponsor, session };
}
type World = Awaited<ReturnType<typeof world>>;

const denied = async (work: Promise<unknown>) => {
  const error = await work.then(() => null, caught => caught);
  expect(error, 'expected an opaque denial').toBeInstanceOf(CoManagedSharedWorkError);
  expect(error.message).toBe('This shared resource is not available for the requested operation.');
};
const listed = async (w: World, who: Session) => (await listCoManagedCustomerTickets(db, who)).rows.map(row => row.resource.id);

describe.sequential('L2 access matrix against real rows', () => {
  it('(a) MT and MV list and read a shared-board ticket; MX gets nothing and a direct fetch is opaque', async () => {
    const w = await world();
    for (const who of [w.MT, w.MV]) {
      expect(await listed(w, who.actor)).toEqual([w.ticketId]);
      expect(await getCoManagedSharedWorkSummary(db, who.actor, w.resource)).toMatchObject({ resource: w.resource, fields: { title: 'Shared board ticket' } });
      await withCoManagedSharedWork(db, who.actor, w.resource, 'read', async context => { expect(context.action).toBe('read'); });
    }
    // Staff role: the technician may write, the viewer may not.
    await withCoManagedSharedWork(db, w.MT.actor, w.resource, 'update', async () => undefined);
    await denied(withCoManagedSharedWork(db, w.MV.actor, w.resource, 'update', async () => undefined));
    expect(await listed(w, w.MX.actor)).toEqual([]);
    await denied(getCoManagedSharedWorkSummary(db, w.MX.actor, w.resource));
    await denied(withCoManagedSharedWork(db, w.MX.actor, w.resource, 'read', async () => undefined));
  });

  it('(a) escalation_only keeps the board grants in the table but grants nothing', async () => {
    const w = await world();
    const before = await w.customer.table('co_management_board_scopes').where('relationship_id', w.relationshipId);
    expect(before).toHaveLength(1);
    await replaceCoManagedCustomerScope(db, w.customerAdmin, w.target, await w.revision(),
      { visibilityMode: 'escalation_only', boards: [{ id: w.boardId, canCollaborate: true }], projects: [] });
    expect(await w.customer.table('co_management_board_scopes').where('relationship_id', w.relationshipId)).toHaveLength(1);
    for (const who of [w.MT, w.MV]) {
      expect(await listed(w, who.actor)).toEqual([]);
      await denied(getCoManagedSharedWorkSummary(db, who.actor, w.resource));
    }
    // Back to board_scope: the dormant row is live again without being re-entered.
    await replaceCoManagedCustomerScope(db, w.customerAdmin, w.target, await w.revision(),
      { visibilityMode: 'board_scope', boards: [{ id: w.boardId, canCollaborate: true }], projects: [] });
    expect(await listed(w, w.MT.actor)).toEqual([w.ticketId]);
  });
});

describe.sequential('sponsor administration: read vs manage', () => {
  it('lists the live sponsored relationship for read or manage, independent of delegated grants; policy reads need read, writes need manage', async () => {
    const w = await world();
    const reader = await w.session(w.sponsorTenant, (await (async () => {
      const userId = randomUUID();
      await w.sponsor.table('users').insert({ tenant: w.sponsorTenant, user_id: userId, username: `reader-${userId}`, email: `reader-${userId}@example.test`,
        first_name: 'Rea', last_name: 'Der', hashed_password: 'x', user_type: 'internal', is_inactive: false });
      const roleId = randomUUID(), permissionId = randomUUID();
      await w.sponsor.table('roles').insert({ tenant: w.sponsorTenant, role_id: roleId, role_name: `Reader ${roleId}`, description: 't', msp: true, client: false });
      await w.sponsor.table('permissions').insert({ tenant: w.sponsorTenant, permission_id: permissionId, resource: 'co_management', action: 'read', msp: true, client: false });
      await w.sponsor.table('role_permissions').insert({ tenant: w.sponsorTenant, role_id: roleId, permission_id: permissionId });
      await w.sponsor.table('user_roles').insert({ tenant: w.sponsorTenant, user_id: userId, role_id: roleId });
      return userId;
    })()));
    // No delegated grant exists anywhere, yet both the manager and the read-only user see the workspace.
    for (const who of [w.admin, reader]) {
      expect(await listCoManagedLiveSponsoredRelationships(db, who)).toEqual([expect.objectContaining({ relationshipId: w.relationshipId, customerTenant: w.customerTenant })]);
    }
    expect((await getCoManagedCollaborationPolicy(db, reader, w.target)).revision).toBeGreaterThan(0);
    const writeError = await replaceCoManagedStaffAssignments(db, reader, w.target, await w.revision(), []).then(() => null, caught => caught);
    expect(writeError).toBeInstanceOf(CoManagedPolicyError);
    expect(writeError.code).toBe('PERMISSION_DENIED');
    // A technician without any co-management permission is told so, and sees no workspaces.
    const noRead = await listCoManagedLiveSponsoredRelationships(db, w.MT.actor).then(() => null, caught => caught);
    expect(noRead).toBeInstanceOf(CoManagedPolicyError);
    expect(noRead.code).toBe('PERMISSION_DENIED');
    const readDenied = await getCoManagedCollaborationPolicy(db, w.MT.actor, w.target).then(() => null, caught => caught);
    expect(readDenied?.code).toBe('PERMISSION_DENIED');
  });
});

describe.sequential('(b) revocation takes effect on the next request', () => {
  const readable = async (w: World, who: Session) => {
    expect(await listed(w, who)).toEqual([w.ticketId]);
    await getCoManagedSharedWorkSummary(db, who, w.resource);
  };
  const gone = async (w: World, who: Session) => {
    expect(await listed(w, who)).toEqual([]);
    await denied(getCoManagedSharedWorkSummary(db, who, w.resource));
    await denied(withCoManagedSharedWork(db, who, w.resource, 'read', async () => undefined));
  };

  it('removing the board from the customer scope', async () => {
    const w = await world();
    await readable(w, w.MT.actor);
    await replaceCoManagedCustomerScope(db, w.customerAdmin, w.target, await w.revision(), { visibilityMode: 'board_scope', boards: [], projects: [] });
    await gone(w, w.MT.actor); await gone(w, w.MV.actor);
  });

  it('removing the staff assignment', async () => {
    const w = await world();
    await readable(w, w.MT.actor);
    await replaceCoManagedStaffAssignments(db, w.admin, w.target, await w.revision(), [{ kind: 'user', principalId: w.MV.userId, role: 'viewer' }]);
    await gone(w, w.MT.actor);
    await readable(w, w.MV.actor);
  });

  it('removing the home permission', async () => {
    const w = await world();
    await readable(w, w.MT.actor);
    await w.sponsor.table('role_permissions').where({ role_id: w.MT.roleId, permission_id: w.MT.ids['ticket:read'] }).delete();
    await gone(w, w.MT.actor);
    await readable(w, w.MV.actor);
  });

  it('ending the relationship', async () => {
    const w = await world();
    await readable(w, w.MT.actor);
    await w.customer.table('co_management_relationships').where('relationship_id', w.relationshipId)
      .update({ state: 'terminated', ended_at: db.fn.now(), revision: db.raw('revision + 1') });
    await gone(w, w.MT.actor); await gone(w, w.MV.actor);
  });
});

describe.sequential('(c) delegated administration round trip', () => {
  it('customer grants, technician executes, receipt is immutable, viewer is refused, revocation ends it', async () => {
    const w = await world();
    const grantId = randomUUID();
    await saveCoManagedDelegatedGrant(db, w.customerAdmin, w.target, await w.revision(),
      { grantId, principalType: 'user', principalId: w.MT.userId, operation: 'board_settings', targetId: w.boardId });
    const screen = await getCoManagedDelegatedScreen(db, w.MT.actor, w.target);
    const entry = screen.grants.find((grant: any) => grant.grantId === grantId);
    expect(entry).toMatchObject({ available: true, operation: 'board_settings' });
    const command = { operationId: randomUUID(), grantId, expectedVersion: entry.version, patch: { board_name: 'Renamed by MSP' } };

    await denied(executeCoManagedDelegatedCommand(db, w.MV.actor, w.target, { ...command, operationId: randomUUID() }));
    expect((await w.customer.table('boards').where('board_id', w.boardId).first()).board_name).toBe('Service Desk');

    await executeCoManagedDelegatedCommand(db, w.MT.actor, w.target, command);
    expect((await w.customer.table('boards').where('board_id', w.boardId).first()).board_name).toBe('Renamed by MSP');
    const receipt = await w.customer.table('co_management_delegated_receipts').where('operation_id', command.operationId).first();
    expect(receipt).toMatchObject({ grant_id: grantId, actor_tenant: w.sponsorTenant, actor_user_id: w.MT.userId });
    // A retry of the same operation is an exact replay, not a second write.
    await executeCoManagedDelegatedCommand(db, w.MT.actor, w.target, command);
    expect(await w.customer.table('co_management_delegated_receipts').where('operation_id', command.operationId)).toHaveLength(1);

    const audit = await w.customer.table('audit_logs').where({ operation: 'co_managed_delegated_administration', record_id: w.boardId });
    expect(audit).toHaveLength(1);
    expect(audit[0].tenant).toBe(w.customerTenant);
    expect(audit[0].details).toMatchObject({ actor_tenant: w.sponsorTenant, actor_user_id: w.MT.userId, grant_id: grantId });
    expect(await w.sponsor.table('audit_logs').where('operation', 'co_managed_delegated_administration')).toHaveLength(0);

    await denied(coManagedDelegatedReceipts.update(w.customer, { board: 'x' }));
    await denied(coManagedDelegatedReceipts.delete(w.customer, command.operationId));
    expect(await w.customer.table('co_management_delegated_receipts').where('operation_id', command.operationId).first()).toEqual(receipt);

    await revokeCoManagedDelegatedGrant(db, w.customerAdmin, w.target, await w.revision(), grantId);
    const next = { operationId: randomUUID(), grantId, expectedVersion: entry.version, patch: { board_name: 'Second rename' } };
    await expect(executeCoManagedDelegatedCommand(db, w.MT.actor, w.target, next))
      .rejects.toBeInstanceOf(CoManagedDelegationError);
    expect((await w.customer.table('boards').where('board_id', w.boardId).first()).board_name).toBe('Renamed by MSP');
    expect(await w.customer.table('co_management_delegated_receipts').where('operation_id', next.operationId)).toHaveLength(0);
  });
});

describe.sequential('(d) the psa budget', () => {
  const COMANAGED_TABLE = /\b(co_management_\w+|co_managed_\w+|collaboration_actor_references)\b/i;

  it('a psa tenant with the capability off loads a ticket and its comments without touching any co-managed table', async () => {
    const operation = await prepareNativeAccessOperation(db);
    // Control: the matcher does see co-managed tables when the co-managed read model runs.
    const w = await world(); // built while the capability is on
    const seen: string[] = [];
    const watch = (query: { sql: string }) => seen.push(query.sql);
    db.on('query', watch);
    try { await listCoManagedCustomerTickets(db, w.MT.actor); } finally { db.removeListener('query', watch); }
    expect(seen.some(sql => COMANAGED_TABLE.test(sql))).toBe(true);
    const tenant = operation.tenant, home = tenantDb(db, tenant);
    // Home RBAC for the psa technician: read tickets and comments, nothing co-managed.
    const roleId = randomUUID(), userId = randomUUID(), clientId = (await home.table('clients').first()).client_id;
    await home.table('roles').insert({ tenant, role_id: roleId, role_name: `PSA ${roleId}`, msp: true, client: false });
    for (const [resource, action] of [['ticket', 'read'], ['ticket', 'update'], ['client', 'read'], ['user', 'read']]) {
      const permissionId = randomUUID();
      await home.table('permissions').insert({ tenant, permission_id: permissionId, resource, action, msp: true, client: false });
      await home.table('role_permissions').insert({ tenant, role_id: roleId, permission_id: permissionId });
    }
    await home.table('users').insert({ tenant, user_id: userId, username: `psa-${userId}`, email: `psa-${userId}@example.test`, first_name: 'Plain',
      last_name: 'Psa', hashed_password: 'test-not-a-login', user_type: 'internal', is_inactive: false });
    await home.table('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
    const boardId = operation.escalation_board_id as string;
    const statusId = randomUUID(), ticketId = randomUUID();
    await home.table('statuses').insert({ tenant, status_id: statusId, name: 'Open', status_type: 'ticket', item_type: 'ticket', board_id: boardId,
      order_number: 1, is_closed: false, created_by: userId });
    await home.table('tickets').insert({ tenant, ticket_id: ticketId, title: 'Plain psa ticket', ticket_number: 'PSA-1', client_id: clientId, board_id: boardId,
      status_id: statusId, entered_by: userId, entered_at: new Date() });
    const commentId = randomUUID(), threadId = randomUUID();
    await home.table('comment_threads').insert({ tenant, thread_id: threadId, ticket_id: ticketId, root_comment_id: commentId, created_by: userId });
    await home.table('comments').insert({ tenant, comment_id: commentId, thread_id: threadId, ticket_id: ticketId, user_id: userId, author_type: 'internal',
      note: 'hello', is_internal: false, is_resolution: false });
    actorState.user = { tenant, user_id: userId, user_type: 'internal', username: `psa-${userId}`, email: `psa-${userId}@example.test` };

    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    const { getConsolidatedTicketData } = await import('../../../../../packages/tickets/src/actions/optimizedTicketActions');
    const captured: string[] = [];
    const record = (query: { sql: string }) => captured.push(query.sql);
    db.on('query', record);
    let data: any;
    try { data = await runWithTenant(tenant, () => getConsolidatedTicketData(ticketId)); } finally { db.removeListener('query', record); }
    expect(data?.ticket?.ticket_id ?? data?.ticket_id, JSON.stringify(data)?.slice(0, 300)).toBe(ticketId);
    expect(captured.length).toBeGreaterThan(0);
    expect(JSON.stringify(data)).toContain('hello'); // the comment read really happened on this path
    expect(captured.filter(sql => COMANAGED_TABLE.test(sql))).toEqual([]);
  });
});


// The real capability gate (flag + entitlement + product code), real actions, real rows. Only the session
// lookup and the release-flag provider are seams.
describe.sequential('policy actions gate by relationship side', () => {
  const COMANAGED_TABLE = /\b(co_management_\w+|co_managed_\w+|collaboration_actor_references)\b/i;
  const asUser = async (tenant: string, userId: string) => {
    const user = await tenantDb(db, tenant).table('users').where({ user_id: userId }).first();
    actorState.user = { tenant, user_id: userId, user_type: user.user_type, username: user.username, email: user.email };
    actorState.session = { session_id: randomUUID(), user: { tenant, id: userId, user_type: user.user_type } };
  };
  const actions = async () => import('../../../../../server/src/lib/actions/coManagedPolicyActions');
  const sessionOf = async (w: World, tenant: string, userId: string) => {
    await asUser(tenant, userId);
    const sessionId = actorState.session.session_id;
    await tenantDb(db, tenant).table('sessions').insert({ tenant, session_id: sessionId, user_id: userId, expires_at: new Date(Date.now() + 3600000) });
  };
  const capture = async <T>(work: () => Promise<T>) => {
    const seen: string[] = [];
    const watch = (query: { sql: string }) => seen.push(query.sql);
    db.on('query', watch);
    try { return { value: await work(), seen }; } finally { db.removeListener('query', watch); }
  };

  it('(a)(b)(c) a co_managed customer reads and edits its own policy; removal revokes the MSP user on the next request', async () => {
    const w = await world();
    const a = await actions();
    await sessionOf(w, w.customerTenant, w.customerAdmin.userId);
    const read = await a.getCoManagedPolicyAction(w.relationshipId) as any;
    expect(read).toMatchObject({ ok: true, side: 'customer' });
    expect(read.policy.boards).toEqual([expect.objectContaining({ id: w.boardId, canCollaborate: true })]);
    const save = (revision: number, scope: any) => a.replaceCoManagedCustomerScopeAction(w.relationshipId, revision, scope) as Promise<any>;
    const view = await save(read.policy.revision, { visibilityMode: 'board_scope', boards: [{ id: w.boardId, canCollaborate: false }], projects: [] });
    expect(view.ok).toBe(true);
    expect(view.revision).toBeGreaterThan(read.policy.revision);
    expect(await listed(w, w.MT.actor)).toEqual([w.ticketId]); // View still shares the ticket
    const escalation = await save(view.revision, { visibilityMode: 'escalation_only', boards: [{ id: w.boardId, canCollaborate: false }], projects: [] });
    expect(escalation.revision).toBeGreaterThan(view.revision);
    expect(await listed(w, w.MT.actor)).toEqual([]);
    const back = await save(escalation.revision, { visibilityMode: 'board_scope', boards: [{ id: w.boardId, canCollaborate: true }], projects: [] });
    expect(back.ok).toBe(true);
    expect(await listed(w, w.MT.actor)).toEqual([w.ticketId]);
    const removed = await save(back.revision, { visibilityMode: 'board_scope', boards: [], projects: [] });
    expect(removed.revision).toBeGreaterThan(back.revision);
    await denied(getCoManagedSharedWorkSummary(db, w.MT.actor, w.resource));
    expect(await listed(w, w.MT.actor)).toEqual([]);
    // The customer side never runs the sponsor admission (its entitlement row lock).
    admission.fn.mockClear();
    await a.getCoManagedPolicyAction(w.relationshipId);
    expect(admission.fn).not.toHaveBeenCalled();
  });

  it('assignee names resolve in the sponsor tenant for both sides (customer included)', async () => {
    const w = await world();
    const a = await actions();
    const teamId = randomUUID();
    await tenantDb(db, w.sponsorTenant).table('teams').insert({ tenant: w.sponsorTenant, team_id: teamId, team_name: 'Sponsor Service Desk', manager_id: w.MT.userId });
    await replaceCoManagedStaffAssignments(db, w.admin, w.target, await w.revision(), [
      { kind: 'user', principalId: w.MT.userId, role: 'technician' }, { kind: 'user', principalId: w.MV.userId, role: 'viewer' },
      { kind: 'team', principalId: teamId, role: 'viewer' }]);
    const read = async (tenant: string, userId: string) => {
      await sessionOf(w, tenant, userId);
      return await a.getCoManagedPolicyAction(w.relationshipId) as any;
    };
    const customerView = await read(w.customerTenant, w.customerAdmin.userId);
    expect(customerView.side).toBe('customer');
    const sponsorView = await read(w.sponsorTenant, w.admin.userId);
    expect(sponsorView.side).toBe('sponsor');
    for (const view of [customerView, sponsorView]) {
      expect(view.names.users[w.MT.userId]).toBe('MT Tech');
      expect(view.names.users[w.MV.userId]).toBe('MV Tech');
      expect(view.names.teams[teamId]).toBe('Sponsor Service Desk');
      for (const name of [...Object.values(view.names.users), ...Object.values(view.names.teams)] as string[]) {
        expect(name).not.toBe('');
        expect(name).not.toContain('null');
      }
    }
    expect(customerView.names).toEqual(sponsorView.names);
  });

  it('(e) the sponsor side still passes admits and still runs the sponsor admission', async () => {
    const w = await world();
    const a = await actions();
    await sessionOf(w, w.sponsorTenant, w.admin.userId);
    admission.fn.mockClear();
    const value = await a.getCoManagedPolicyAction(w.relationshipId) as any;
    expect(value).toMatchObject({ ok: true, side: 'sponsor' });
    expect(admission.fn).toHaveBeenCalledWith(w.sponsorTenant, expect.anything());
  });

  it('(d) the kill switch closes both sides with zero co-managed queries', async () => {
    const w = await world();
    const a = await actions();
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    for (const [tenant, userId] of [[w.customerTenant, w.customerAdmin.userId], [w.sponsorTenant, w.admin.userId]] as const) {
      await sessionOf(w, tenant, userId);
      const { seen, value } = await capture(() => a.getCoManagedPolicyAction(w.relationshipId).then(() => null, (e: any) => e));
      expect((value as any)?.code).toBe('CAPABILITY_UNAVAILABLE');
      expect(seen.filter(sql => COMANAGED_TABLE.test(sql))).toEqual([]);
    }
  });

  it('(d) flag off refuses the sponsor; the customer is still served; a psa tenant with no entitlement never reaches the policy tables', async () => {
    const w = await world();
    const a = await actions();
    flag.on = false;
    await sessionOf(w, w.sponsorTenant, w.admin.userId);
    const sponsorError = await a.getCoManagedPolicyAction(w.relationshipId).then(() => null, (e: any) => e);
    expect(sponsorError?.code).toBe('CAPABILITY_UNAVAILABLE');
    // serves has no flag by design: an existing customer workspace keeps working.
    await sessionOf(w, w.customerTenant, w.customerAdmin.userId);
    expect(await a.getCoManagedPolicyAction(w.relationshipId)).toMatchObject({ ok: true, side: 'customer' });
    // A psa tenant that was never entitled: refused, and nothing beyond the gate's own resolver reads is issued.
    const plain = { tenant: randomUUID(), requested_by: randomUUID(), relationship_id: randomUUID() };
    await tenantDb(db, plain.tenant).table('tenants').insert({ tenant: plain.tenant, client_name: 'Plain MSP', email: `plain-${plain.tenant}@example.test`, plan: 'pro', product_code: 'psa' });
    await tenantDb(db, plain.tenant).table('users').insert({ tenant: plain.tenant, user_id: plain.requested_by, username: `plain-${plain.requested_by}`,
      email: `plain-${plain.requested_by}@example.test`, first_name: 'Plain', last_name: 'Admin', hashed_password: 'x', user_type: 'internal', is_inactive: false });
    for (const on of [false, true]) {
      flag.on = on; clearCapabilityCache();
      await sessionOf(w, plain.tenant, plain.requested_by);
      const { seen, value } = await capture(() => a.getCoManagedPolicyAction(plain.relationship_id).then(() => null, (e: any) => e));
      expect((value as any)?.code).toBe('CAPABILITY_UNAVAILABLE');
      expect(seen.filter(sql => /co_management_(board|project|staff|policy|scopes)|co_managed_provisioning_operations|co_management_relationships.*relationship_id/i.test(sql) && !/distinct/i.test(sql))).toEqual([]);
    }
  });
});
