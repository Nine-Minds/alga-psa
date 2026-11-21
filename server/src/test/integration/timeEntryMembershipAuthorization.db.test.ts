import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';
import { createAuthorizationKernel, BundleAuthorizationKernelProvider, BuiltinAuthorizationKernelProvider, RequestLocalAuthorizationCache } from '@alga-psa/authorization/kernel';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: unknown) => action,
  hasPermission: vi.fn(async () => true),
}));

vi.mock('../../../../packages/scheduling/src/actions/timeEntryDelegationAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../packages/scheduling/src/actions/timeEntryDelegationAuth')>()),
  // Management makes the subject readable absent the bundle's own-only rule.
  resolveManagedSubjectUserIds: vi.fn(async () => ['82000000-0000-4000-8000-000000000003']),
}));

vi.mock('@shared/services/productAccessGuard', () => ({
  assertPsaOnlyTenantAccess: vi.fn(async () => undefined),
}));

const TENANT = '82000000-0000-4000-8000-000000000001';
const ACTOR = '82000000-0000-4000-8000-000000000002';
const SUBJECT = '82000000-0000-4000-8000-000000000003';
const ROLE = '82000000-0000-4000-8000-000000000004';
const TEAM = '82000000-0000-4000-8000-000000000005';
const BUNDLE = '82000000-0000-4000-8000-000000000006';
const REVISION = '82000000-0000-4000-8000-000000000007';
const RULE = '82000000-0000-4000-8000-000000000008';

type MembershipKind = 'role' | 'team';

async function createAuthorizationFixture(
  trx: Knex.Transaction,
  kind: MembershipKind,
  action = 'read',
) {
  await trx.raw(`
    CREATE TEMP TABLE users (tenant uuid, user_id uuid, reports_to uuid, first_name text, last_name text) ON COMMIT DROP;
    CREATE TEMP TABLE teams (tenant uuid, team_id uuid, manager_id uuid) ON COMMIT DROP;
    CREATE TEMP TABLE team_members (tenant uuid, team_id uuid, user_id uuid) ON COMMIT DROP;
    CREATE TEMP TABLE user_roles (tenant uuid, user_id uuid, role_id uuid) ON COMMIT DROP;
    CREATE TEMP TABLE time_entries (
      tenant uuid, entry_id uuid, user_id uuid, work_item_type text, work_item_id uuid,
      start_time timestamptz, end_time timestamptz, work_date date, billable_duration integer,
      notes text, approval_status text, service_id uuid, billing_mode text
    ) ON COMMIT DROP;
    CREATE TEMP TABLE service_catalog (tenant uuid, service_id uuid, service_name text) ON COMMIT DROP;
    CREATE TEMP TABLE authorization_bundle_assignments (
      tenant uuid, bundle_id uuid, target_type text, target_id uuid, status text
    ) ON COMMIT DROP;
    CREATE TEMP TABLE authorization_bundles (
      tenant uuid, bundle_id uuid, status text, published_revision_id uuid
    ) ON COMMIT DROP;
    CREATE TEMP TABLE authorization_bundle_rules (
      tenant uuid, rule_id uuid, bundle_id uuid, revision_id uuid, resource_type text, action text,
      template_key text, constraint_key text, config jsonb
    ) ON COMMIT DROP;
    CREATE TEMP TABLE authorization_bundle_revisions (
      tenant uuid, bundle_id uuid, revision_id uuid, baseline text
    ) ON COMMIT DROP;
  `);
  await trx('users').insert([
    { tenant: TENANT, user_id: ACTOR, reports_to: null, first_name: 'Actor', last_name: 'User' },
    { tenant: TENANT, user_id: SUBJECT, reports_to: null, first_name: 'Subject', last_name: 'User' },
  ]);
  if (kind === 'role') {
    await trx('user_roles').insert({ tenant: TENANT, user_id: ACTOR, role_id: ROLE });
  } else {
    await trx('teams').insert({ tenant: TENANT, team_id: TEAM, manager_id: null });
    await trx('team_members').insert({ tenant: TENANT, team_id: TEAM, user_id: ACTOR });
  }
  await trx('authorization_bundles').insert({
    tenant: TENANT,
    bundle_id: BUNDLE,
    status: 'active',
    published_revision_id: REVISION,
  });
  await trx('authorization_bundle_assignments').insert({
    tenant: TENANT,
    bundle_id: BUNDLE,
    target_type: kind,
    target_id: kind === 'role' ? ROLE : TEAM,
    status: 'active',
  });
  await trx('authorization_bundle_revisions').insert({
    tenant: TENANT,
    bundle_id: BUNDLE,
    revision_id: REVISION,
    baseline: 'open',
  });
  await trx('authorization_bundle_rules').insert({
    tenant: TENANT,
    rule_id: RULE,
    bundle_id: BUNDLE,
    revision_id: REVISION,
    resource_type: 'time_entry',
    action,
    template_key: 'own',
    constraint_key: null,
    config: {},
  });
}

describe('time-entry bundle membership authorization (PostgreSQL)', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({
      recreate: false,
      runSeeds: false,
    });
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it.each<MembershipKind>(['role', 'team'])(
    'keeps the %s-assigned rule in the ticket time-entry read path when the subject has empty placeholders',
    async (kind) => {
      const trx = await db.transaction();
      try {
        await createAuthorizationFixture(trx, kind);
        await trx('time_entries').insert([
          {
            tenant: TENANT, entry_id: '82000000-0000-4000-8000-000000000009', user_id: ACTOR,
            work_item_type: 'ticket', work_item_id: '82000000-0000-4000-8000-000000000010',
            start_time: new Date('2026-11-20T10:00:00Z'), end_time: new Date('2026-11-20T10:30:00Z'),
            work_date: '2026-11-20', billable_duration: 30, notes: 'own', approval_status: 'DRAFT', service_id: null,
          },
          {
            tenant: TENANT, entry_id: '82000000-0000-4000-8000-000000000011', user_id: SUBJECT,
            work_item_type: 'ticket', work_item_id: '82000000-0000-4000-8000-000000000010',
            start_time: new Date('2026-11-20T11:00:00Z'), end_time: new Date('2026-11-20T11:30:00Z'),
            work_date: '2026-11-20', billable_duration: 30, notes: 'restricted', approval_status: 'SUBMITTED', service_id: null,
          },
        ]);

        const { fetchTimeEntriesForTicketCore } = await import('../../../../packages/scheduling/src/actions/timeEntryTicketActions');
        const result = await fetchTimeEntriesForTicketCore(
          { user_id: ACTOR, user_type: 'internal', clientId: null } as never,
          TENANT,
          trx,
          '82000000-0000-4000-8000-000000000010',
        );
        expect(result.entries.map((entry) => entry.user_id)).toEqual([ACTOR]);
        expect(result.othersHiddenCount).toBe(1);

        await trx('authorization_bundle_rules').where({ tenant: TENANT, rule_id: RULE }).delete();
        const withoutBundleRestriction = await fetchTimeEntriesForTicketCore(
          { user_id: ACTOR, user_type: 'internal', clientId: null } as never,
          TENANT,
          trx,
          '82000000-0000-4000-8000-000000000010',
        );
        expect(withoutBundleRestriction.entries.map((entry) => entry.user_id).sort()).toEqual([ACTOR, SUBJECT].sort());
        expect(withoutBundleRestriction.othersHiddenCount).toBe(0);
      } finally {
        await trx.rollback();
      }
    },
  );

  it.each<MembershipKind>(['role', 'team'])(
    'enforces the %s-assigned approval rule when the delegation subject has empty placeholders',
    async (kind) => {
      const trx = await db.transaction();
      try {
        await createAuthorizationFixture(trx, kind, 'approve');
        const { assertCanApproveSubject } = await import('../../../../packages/scheduling/src/actions/timeEntryDelegationAuth');
        await expect(assertCanApproveSubject(
          { user_id: ACTOR, user_type: 'internal', clientId: null } as never,
          TENANT,
          SUBJECT,
          trx,
        )).rejects.toThrow('Permission denied: Cannot approve your own time submissions');
      } finally {
        await trx.rollback();
      }
    },
  );

  it('accepts an explicitly complete trusted-empty snapshot but ignores it for locked evaluation', async () => {
    const trx = await db.transaction();
    try {
      await createAuthorizationFixture(trx, 'role');
      const input = {
        subject: { tenant: TENANT, userId: ACTOR, userType: 'internal' as const, roleIds: [], teamIds: [] },
        resource: { type: 'time_entry', action: 'read' },
        trustedMembershipSnapshot: {
          complete: true as const, tenant: TENANT, userId: ACTOR, roleIds: [], teamIds: [],
        },
        knex: trx,
      };

      await trx('user_roles').where({ tenant: TENANT, user_id: ACTOR }).delete();
      const trustedEmptyRules = await resolveBundleNarrowingRulesForEvaluation(trx, input);
      expect(trustedEmptyRules).toEqual([]);

      await trx('user_roles').insert({ tenant: TENANT, user_id: ACTOR, role_id: ROLE });
      const lockedRules = await resolveBundleNarrowingRulesForEvaluation(trx, input, { lock: true });
      expect(lockedRules).toHaveLength(1);
      const kernel = createAuthorizationKernel({
        builtinProvider: new BuiltinAuthorizationKernelProvider(),
        bundleProvider: new BundleAuthorizationKernelProvider({ resolveRules: async () => lockedRules }),
        rbacEvaluator: async () => true,
      });
      const decision = await kernel.authorizeResource({
        ...input,
        record: { id: SUBJECT, ownerUserId: SUBJECT },
        requestCache: new RequestLocalAuthorizationCache(),
      });
      expect(decision.allowed).toBe(false);
    } finally {
      await trx.rollback();
    }
  });

  it.each([
    ['incomplete', { complete: false, tenant: TENANT, userId: ACTOR, roleIds: [], teamIds: [] }],
    ['tenant-mismatched', { complete: true, tenant: '82000000-0000-4000-8000-000000000099', userId: ACTOR, roleIds: [], teamIds: [] }],
    ['user-mismatched', { complete: true, tenant: TENANT, userId: SUBJECT, roleIds: [], teamIds: [] }],
  ])('reloads memberships when the supplied snapshot is %s', async (_label, snapshot) => {
    const trx = await db.transaction();
    try {
      await createAuthorizationFixture(trx, 'role');
      const input = {
        subject: { tenant: TENANT, userId: ACTOR, userType: 'internal' as const, roleIds: [], teamIds: [] },
        resource: { type: 'ticket', action: 'read' },
        trustedMembershipSnapshot: snapshot as unknown as {
          complete: true;
          tenant: string;
          userId: string;
          roleIds: readonly string[];
          teamIds: readonly string[];
        },
        knex: trx,
      };

      const rules = await resolveBundleNarrowingRulesForEvaluation(trx, input);
      expect(rules).toHaveLength(1);
    } finally {
      await trx.rollback();
    }
  });
});
