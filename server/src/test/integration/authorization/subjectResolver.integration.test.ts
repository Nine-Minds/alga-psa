import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { TestContext } from '../../../../test-utils/testContext';
import { createClient, createUser } from '../../../../test-utils/testDataFactory';
import { setUserClientPortfolio } from '@alga-psa/authorization/portfolios/service';
import { tenantDb } from '@alga-psa/db';
import type { AuthorizationSubject } from '@alga-psa/authorization/kernel';
import {
  probeTenantAuthorizationScope,
  resolveAuthorizationSubject,
} from '@alga-psa/authorization/subject';
import { RequestLocalAuthorizationCache } from '@alga-psa/authorization/kernel';

// T001. One user, one stored portfolio, teams and reports. The ticket, project, asset and document
// authorization paths each resolve their own subject for that user, and every one of them must receive
// the identical subject. The subjects are captured where they are built (the pure assemble step every
// path ends in), so the test sees what each path really evaluates with.
//
// T005 (probe half): a tenant leaves the fast path the moment it has a portfolio row or a published
// bundle assignment.

const assembled = vi.hoisted(() => ({ subjects: [] as AuthorizationSubject[] }));

vi.mock('@alga-psa/authorization/subject/assemble', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/authorization/subject/assemble')>();
  return {
    ...actual,
    assembleAuthorizationSubject: (...args: Parameters<typeof actual.assembleAuthorizationSubject>) => {
      const subject = actual.assembleAuthorizationSubject(...args);
      assembled.subjects.push(subject);
      return subject;
    },
  };
});

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;

describe('one subject resolver: every authorization path receives the same subject', () => {
  let ctx: TestContext;
  let clientA: string;
  let clientB: string;
  let managedUser: string;
  let teamId: string;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: ['user_client_portfolios', 'team_members', 'teams', 'authorization_bundle_assignments', 'authorization_bundles'],
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    assembled.subjects.length = 0;
    clientA = await createClient(ctx.db, ctx.tenantId, 'Portfolio Client A');
    clientB = await createClient(ctx.db, ctx.tenantId, 'Portfolio Client B');
    managedUser = await createUser(ctx.db, ctx.tenantId);
    await tenantDb(ctx.db, ctx.tenantId).table('users').where({ user_id: managedUser }).update({ reports_to: ctx.user.user_id });
    teamId = uuidv4();
    const scoped = tenantDb(ctx.db, ctx.tenantId);
    await scoped.table('teams').insert({ tenant: ctx.tenantId, team_id: teamId, team_name: 'Subject team', manager_id: ctx.user.user_id });
    await scoped.table('team_members').insert({ tenant: ctx.tenantId, team_id: teamId, user_id: ctx.user.user_id, role: 'member' });
    await setUserClientPortfolio(ctx.db, { tenant: ctx.tenantId, userId: ctx.user.user_id, clientIds: [clientA, clientB] });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  const user = () => ({ ...ctx.user, user_type: 'internal' as const, roles: [] }) as any;

  async function captureSubject(label: string, run: () => Promise<unknown>): Promise<AuthorizationSubject> {
    assembled.subjects.length = 0;
    await run();
    expect(assembled.subjects.length, `${label} built no subject`).toBeGreaterThan(0);
    // Everything one path builds is already one subject; compare the first.
    const [first, ...rest] = assembled.subjects;
    for (const other of rest) expect(other, `${label} built two different subjects`).toEqual(first);
    return first;
  }

  it('T001: tickets, projects, assets and documents evaluate with the identical subject, portfolio included', async () => {
    const trx = ctx.db;

    const { createTicketAuthorizationContext } = await import('@alga-psa/authorization/ticketRecordAuthorization');
    const { createProjectReadDecider } = await import('@alga-psa/projects/lib/projectReadAuthorization');
    const { createAssetReadContext } = await import('@alga-psa/authorization/assetReadAuthorization');
    const { authorizeAndRedactDocuments } = await import('@alga-psa/shared/lib/documentAuthorization');

    const tickets = await captureSubject('tickets', () => createTicketAuthorizationContext(trx, ctx.tenantId, user()));
    const projects = await captureSubject('projects', async () => {
      const decide = await createProjectReadDecider(trx, ctx.tenantId, user());
      await decide({ project_id: uuidv4(), client_id: clientA, assigned_to: null });
    });
    const assets = await captureSubject('assets', () => createAssetReadContext(trx, ctx.tenantId, user()));
    const documents = await captureSubject('documents', () =>
      authorizeAndRedactDocuments(trx as any, ctx.tenantId, user(), [
        { document_id: uuidv4(), created_by: ctx.user.user_id, is_client_visible: false } as any,
      ]),
    );

    expect(tickets.portfolioClientIds).toEqual([clientA, clientB].sort());
    expect(tickets.teamIds).toEqual([teamId]);
    expect(tickets.managedUserIds).toEqual([managedUser]);

    expect(projects).toEqual(tickets);
    expect(assets).toEqual(tickets);
    expect(documents).toEqual(tickets);
  }, HOOK_TIMEOUT);

  it('T001: the REST principal path resolves the same subject, and sees the stored portfolio', async () => {
    const viaRest = await resolveAuthorizationSubject(ctx.db, {
      tenant: ctx.tenantId,
      // The REST principal carries snake_case identity and no roles array.
      user: { user_id: ctx.user.user_id, user_type: 'internal', client_id: undefined },
    });
    const { createAssetReadContext } = await import('@alga-psa/authorization/assetReadAuthorization');
    const viaAssets = (await createAssetReadContext(ctx.db, ctx.tenantId, user())).subject;

    expect(viaRest.portfolioClientIds).toEqual([clientA, clientB].sort());
    expect(viaRest).toEqual(viaAssets);
  }, HOOK_TIMEOUT);

  it('T001: a client user always holds their own client in their portfolio, as the project, asset and document paths always have', async () => {
    const clientUser = { user_id: uuidv4(), user_type: 'client' as const, clientId: clientA };
    const subject = await resolveAuthorizationSubject(ctx.db, { tenant: ctx.tenantId, user: clientUser });
    expect(subject.userType).toBe('client');
    expect(subject.clientId).toBe(clientA);
    expect(subject.portfolioClientIds).toEqual([clientA]);
  }, HOOK_TIMEOUT);

  it('T005: the tenant leaves the fast path with a portfolio row or with a published bundle assignment', async () => {
    const scoped = tenantDb(ctx.db, ctx.tenantId);

    // Nothing configured: fast path.
    await scoped.table('user_client_portfolios').del();
    expect(await probeTenantAuthorizationScope(ctx.db, ctx.tenantId)).toEqual({ publishedAssignments: false, portfolios: false, resolverSubjects: false });

    // A portfolio row alone.
    await setUserClientPortfolio(ctx.db, { tenant: ctx.tenantId, userId: ctx.user.user_id, clientIds: [clientA] });
    expect(await probeTenantAuthorizationScope(ctx.db, ctx.tenantId)).toEqual({ publishedAssignments: false, portfolios: true, resolverSubjects: false });
    const withPortfolio = await resolveAuthorizationSubject(ctx.db, { tenant: ctx.tenantId, user: user() });
    expect(withPortfolio.portfolioClientIds).toEqual([clientA]);

    // A bundle assignment alone. A draft (unpublished) bundle does not count.
    await scoped.table('user_client_portfolios').del();
    const bundleId = uuidv4();
    await scoped.table('authorization_bundles').insert({
      tenant: ctx.tenantId, bundle_id: bundleId, name: 'Fast path probe', status: 'active', published_revision_id: null,
    });
    await scoped.table('authorization_bundle_assignments').insert({
      tenant: ctx.tenantId, assignment_id: uuidv4(), bundle_id: bundleId, target_type: 'user', target_id: ctx.user.user_id, status: 'active',
    });
    expect(await probeTenantAuthorizationScope(ctx.db, ctx.tenantId)).toEqual({ publishedAssignments: false, portfolios: false, resolverSubjects: false });

    const revisionId = uuidv4();
    await scoped.table('authorization_bundle_revisions').insert({
      tenant: ctx.tenantId, revision_id: revisionId, bundle_id: bundleId, revision_number: 1, lifecycle_state: 'published',
    });
    await scoped.table('authorization_bundles').where({ bundle_id: bundleId }).update({ published_revision_id: revisionId });
    expect(await probeTenantAuthorizationScope(ctx.db, ctx.tenantId)).toEqual({ publishedAssignments: true, portfolios: false, resolverSubjects: false });

    // The probe is cached per request: the same cache keeps its first answer.
    const cache = new RequestLocalAuthorizationCache();
    expect((await probeTenantAuthorizationScope(ctx.db, ctx.tenantId, cache)).publishedAssignments).toBe(true);
    await scoped.table('authorization_bundle_assignments').del();
    expect((await probeTenantAuthorizationScope(ctx.db, ctx.tenantId, cache)).publishedAssignments).toBe(true);
    expect((await probeTenantAuthorizationScope(ctx.db, ctx.tenantId)).publishedAssignments).toBe(false);
  }, HOOK_TIMEOUT);
});
