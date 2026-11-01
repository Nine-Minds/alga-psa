// T015 (F050), T016 (F051), T014 (F099 mapping): act-as validation, RBAC intersection, error mapping.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  principal: { value: null as Record<string, unknown> | null },
  users: new Map<string, Record<string, unknown>>(),
  perms: new Map<string, Set<string>>(),
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => ({})),
  registerTenantTables: vi.fn(),
  tenantDb: () => ({ table: () => ({ where: () => ({ first: async () => mocks.principal.value }) }) }),
}));
vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async (id: string) => mocks.users.get(id) ?? null),
}));
vi.mock('server/src/lib/api/rateLimit/apiRateLimitSettingsModel', () => ({ getForKey: vi.fn(async () => null) }));
vi.mock('../../../../../server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async (user: { user_id: string }, resource: string, action: string) =>
    mocks.perms.get(user.user_id)?.has(`${resource}:${action}`) ?? false,
  ),
}));
vi.mock('@alga-psa/licensing', () => ({ getLicenseStateRow: vi.fn(), verifyLicense: vi.fn() }));

import {
  mapServicePrincipalError,
  resolveServicePrincipalApiContext,
} from '../../lib/service-principals/boundary';
import { hasApiContextPermission } from '../../../../../server/src/lib/api/middleware/apiContextPermission';

const TENANT = 't1';
const SVC = '11111111-1111-1111-1111-111111111111';
const HUMAN = '22222222-2222-2222-2222-222222222222';
const CLIENT = '33333333-3333-3333-3333-333333333333';
const SVC2 = '44444444-4444-4444-4444-444444444444';
const key = { tenant: TENANT, user_id: SVC, api_key_id: 'k1' } as never;
const owner = { user_id: SVC, user_type: 'service' };
const req = (actAs?: string) =>
  ({ headers: { get: (n: string) => (n === 'x-alga-act-as' ? (actAs ?? null) : null) } }) as unknown as Request;

describe('act-as boundary (T015/T016)', () => {
  beforeEach(() => {
    mocks.principal.value = { user_id: SVC, allow_act_as: true, archived_at: null, rate_limit_max_tokens: null, rate_limit_refill_per_min: null };
    mocks.users.clear();
    mocks.perms.clear();
    mocks.users.set(HUMAN, { user_id: HUMAN, user_type: 'internal' });
    mocks.users.set(CLIENT, { user_id: CLIENT, user_type: 'client' });
    mocks.users.set(SVC2, { user_id: SVC2, user_type: 'service' });
    mocks.users.set(SVC, { user_id: SVC, user_type: 'service' });
  });

  it('without the header the principal acts as itself, with an sp:<id> bucket', async () => {
    const ctx = await resolveServicePrincipalApiContext(key, owner, req());
    expect(ctx).toMatchObject({ userId: SVC, viaPrincipalUserId: null, actAsUserId: null, rateLimitSubjectId: `sp:${SVC}` });
  });

  it('a human-owned key never resolves through the boundary', async () => {
    expect(await resolveServicePrincipalApiContext(key, { user_id: HUMAN, user_type: 'internal' }, req())).toBeNull();
  });

  it('header without allow_act_as -> 403 ACT_AS_NOT_ALLOWED', async () => {
    mocks.principal.value!.allow_act_as = false;
    await expect(resolveServicePrincipalApiContext(key, owner, req(HUMAN))).rejects.toMatchObject({
      code: 'ACT_AS_NOT_ALLOWED',
      statusCode: 403,
    });
  });

  it.each([
    ['client', CLIENT],
    ['service', SVC2],
    ['unknown / inactive', '55555555-5555-5555-5555-555555555555'],
    ['malformed', 'not-a-uuid'],
  ])('%s target -> 422 ACT_AS_INVALID_TARGET', async (_label, target) => {
    await expect(resolveServicePrincipalApiContext(key, owner, req(target))).rejects.toMatchObject({
      code: 'ACT_AS_INVALID_TARGET',
      statusCode: 422,
    });
  });

  it('valid act-as makes the human effective and the principal the via principal', async () => {
    const ctx = await resolveServicePrincipalApiContext(key, owner, req(HUMAN));
    expect(ctx).toMatchObject({ userId: HUMAN, effectiveUserId: HUMAN, actAsUserId: HUMAN, viaPrincipalUserId: SVC });
    expect((ctx!.user as { user_id: string }).user_id).toBe(HUMAN);
  });

  it('RBAC is the intersection of both subjects', async () => {
    const ctx = (await resolveServicePrincipalApiContext(key, owner, req(HUMAN)))!;
    const check = () => hasApiContextPermission(ctx as never, 'ticket', 'read');

    mocks.perms.set(SVC, new Set(['ticket:read']));
    expect(await check()).toBe(false); // human lacks it
    mocks.perms.set(HUMAN, new Set(['ticket:read']));
    mocks.perms.set(SVC, new Set());
    expect(await check()).toBe(false); // principal lacks it
    mocks.perms.set(SVC, new Set(['ticket:read']));
    expect(await check()).toBe(true); // both hold it
  });

  it('without act-as only the principal is checked', async () => {
    const ctx = (await resolveServicePrincipalApiContext(key, owner, req()))!;
    expect(await hasApiContextPermission(ctx as never, 'ticket', 'read')).toBe(false);
    mocks.perms.set(SVC, new Set(['ticket:read']));
    expect(await hasApiContextPermission(ctx as never, 'ticket', 'read')).toBe(true);
  });
});

describe('error mapping (F099)', () => {
  it('maps HumanWorkOwnerRequiredError to 422 ACT_AS_REQUIRED and passes others through', () => {
    const err = Object.assign(new Error('x'), { name: 'HumanWorkOwnerRequiredError', field: 'created_by' });
    expect(mapServicePrincipalError(err)).toMatchObject({ code: 'ACT_AS_REQUIRED', statusCode: 422 });
    const other = new Error('other');
    expect(mapServicePrincipalError(other)).toBe(other);
  });
});
