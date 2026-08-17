/**
 * Per-credential ACL kernel rules (CredentialSource native store):
 * unrestricted / user-grant / team-grant / owner / denied, and the record
 * hydration that drives them. Mirrors the scope semantics the SQL path compiles
 * in credentialAuthorization.ts — a decision here must equal what the scoped
 * list query hides. No new template keys are introduced (own_or_assigned /
 * same_team only).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

const stubKnex = { __stub: true } as unknown as Knex;
const stubTransaction = stubKnex as unknown as Knex.Transaction;

import {
  buildCredentialAuthorizationKernel,
  getCredentialBuiltinRelationshipRules,
  toCredentialAuthorizationRecord,
} from '@ee/lib/credentials/credentialAuthorization';
import type { CredentialAuthorizationContext } from '@ee/lib/credentials/credentialAuthorization';
import { RequestLocalAuthorizationCache } from '@alga-psa/authorization/kernel';
import type { AuthorizationSubject } from '@alga-psa/authorization/kernel';

const TENANT = 'tenant-a';
const OWNER_ID = 'user-owner';
const OTHER_USER_ID = 'user-other';
const GRANTED_USER_ID = 'user-granted';
const TEAM_A = 'team-a';
const TEAM_B = 'team-b';
const CLIENT_A = 'client-a';
const CREDENTIAL_ID = '11111111-1111-1111-1111-111111111111';

function subject(overrides: Partial<AuthorizationSubject> = {}): AuthorizationSubject {
  return {
    tenant: TENANT,
    userId: OTHER_USER_ID,
    userType: 'internal',
    roleIds: ['role-technician'],
    teamIds: [],
    ...overrides,
  };
}

function baseContext(overrides: Partial<CredentialAuthorizationContext> = {}): CredentialAuthorizationContext {
  return {
    subject: subject(),
    bundleNarrowingRules: [],
    requestCache: new RequestLocalAuthorizationCache(),
    ...overrides,
  };
}

async function decide(
  context: CredentialAuthorizationContext,
  record: ReturnType<typeof toCredentialAuthorizationRecord>
): Promise<boolean> {
  const kernel = buildCredentialAuthorizationKernel(
    context,
    record.isRestricted === true,
    stubTransaction
  );
  const decision = await kernel.authorizeResource({
    subject: context.subject,
    resource: { type: 'credential', action: 'read', id: CREDENTIAL_ID },
    record,
    requestCache: context.requestCache,
    knex: stubKnex,
  });
  return decision.allowed;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('toCredentialAuthorizationRecord hydration', () => {
  it('maps owner (created_by), client and grants onto the standard record fields', () => {
    const record = toCredentialAuthorizationRecord(
      {
        credential_id: CREDENTIAL_ID,
        created_by: OWNER_ID,
        client_id: CLIENT_A,
        is_restricted: true,
      },
      [
        { subject_type: 'user', subject_id: GRANTED_USER_ID },
        { subject_type: 'team', subject_id: TEAM_A },
      ]
    );

    expect(record.id).toBe(CREDENTIAL_ID);
    expect(record.ownerUserId).toBe(OWNER_ID);
    expect(record.clientId).toBe(CLIENT_A);
    expect(record.assignedUserIds).toEqual([GRANTED_USER_ID]);
    expect(record.teamIds).toEqual([TEAM_A]);
    expect(record.isRestricted).toBe(true);
  });

  it('keeps user and team grants separate (no cross-pollution)', () => {
    const record = toCredentialAuthorizationRecord(
      { credential_id: CREDENTIAL_ID, created_by: OWNER_ID, client_id: CLIENT_A, is_restricted: true },
      [
        { subject_type: 'user', subject_id: GRANTED_USER_ID },
        { subject_type: 'team', subject_id: TEAM_A },
        { subject_type: 'team', subject_id: TEAM_B },
      ]
    );

    expect(record.assignedUserIds).toEqual([GRANTED_USER_ID]);
    expect(record.teamIds).toEqual([TEAM_A, TEAM_B]);
  });

  it('exposes isRestricted on the open record index for the decision rules', () => {
    const open = toCredentialAuthorizationRecord(
      { credential_id: CREDENTIAL_ID, created_by: OWNER_ID, client_id: CLIENT_A, is_restricted: false },
      []
    );
    expect(open.isRestricted).toBe(false);
  });
});

describe('getCredentialBuiltinRelationshipRules', () => {
  it('returns no rules for an unrestricted row (RBAC/bundle scope only)', () => {
    expect(getCredentialBuiltinRelationshipRules(false)).toEqual([]);
  });

  it('restricts a restricted row to own_or_assigned and same_team only', () => {
    expect(getCredentialBuiltinRelationshipRules(true)).toEqual([
      { template: 'own_or_assigned' },
      { template: 'same_team' },
    ]);
  });
});

describe('authorizeCredentialRecord decision semantics', () => {
  it('unrestricted rows are visible regardless of ownership or grants', async () => {
    const context = baseContext({ subject: subject() });
    const record = toCredentialAuthorizationRecord(
      { credential_id: CREDENTIAL_ID, created_by: OWNER_ID, client_id: CLIENT_A, is_restricted: false },
      []
    );

    await expect(decide(context, record)).resolves.toBe(true);
  });

  it('restricted rows are visible to the owner (created_by)', async () => {
    const context = baseContext({ subject: subject({ userId: OWNER_ID }) });
    const record = toCredentialAuthorizationRecord(
      { credential_id: CREDENTIAL_ID, created_by: OWNER_ID, client_id: CLIENT_A, is_restricted: true },
      []
    );

    await expect(decide(context, record)).resolves.toBe(true);
  });

  it('restricted rows are visible to an explicitly granted user', async () => {
    const context = baseContext({ subject: subject({ userId: GRANTED_USER_ID }) });
    const record = toCredentialAuthorizationRecord(
      { credential_id: CREDENTIAL_ID, created_by: OWNER_ID, client_id: CLIENT_A, is_restricted: true },
      [{ subject_type: 'user', subject_id: GRANTED_USER_ID }]
    );

    await expect(decide(context, record)).resolves.toBe(true);
  });

  it('restricted rows are visible to a member of a granted team', async () => {
    const context = baseContext({ subject: subject({ teamIds: [TEAM_A] }) });
    const record = toCredentialAuthorizationRecord(
      { credential_id: CREDENTIAL_ID, created_by: OWNER_ID, client_id: CLIENT_A, is_restricted: true },
      [{ subject_type: 'team', subject_id: TEAM_A }]
    );

    await expect(decide(context, record)).resolves.toBe(true);
  });

  it('restricted rows are denied to a stranger (no grant, not owner)', async () => {
    const context = baseContext({ subject: subject() });
    const record = toCredentialAuthorizationRecord(
      { credential_id: CREDENTIAL_ID, created_by: OWNER_ID, client_id: CLIENT_A, is_restricted: true },
      []
    );

    await expect(decide(context, record)).resolves.toBe(false);
  });

  it('restricted rows are denied when the subject belongs to an un-granted team', async () => {
    const context = baseContext({ subject: subject({ teamIds: [TEAM_B] }) });
    const record = toCredentialAuthorizationRecord(
      { credential_id: CREDENTIAL_ID, created_by: OWNER_ID, client_id: CLIENT_A, is_restricted: true },
      [{ subject_type: 'team', subject_id: TEAM_A }]
    );

    await expect(decide(context, record)).resolves.toBe(false);
  });

  it('grants to a different user do not help a stranger', async () => {
    const context = baseContext({ subject: subject() });
    const record = toCredentialAuthorizationRecord(
      { credential_id: CREDENTIAL_ID, created_by: OWNER_ID, client_id: CLIENT_A, is_restricted: true },
      [{ subject_type: 'user', subject_id: GRANTED_USER_ID }]
    );

    await expect(decide(context, record)).resolves.toBe(false);
  });
});
