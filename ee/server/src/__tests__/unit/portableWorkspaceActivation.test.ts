import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A4: each activation precondition has a failing test. The world below is a hand-set description of
 * the restored workspace; the stub `tenantDb` answers the queries the activation module makes.
 */
const world = vi.hoisted(() => ({
  restore: undefined as any, activation: undefined as any, tenant: undefined as any,
  activeUser: undefined as any, admin: undefined as any,
  armed: {} as Record<string, any>, lockTaken: [] as string[], writes: [] as string[], seamAuthority: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      const ops: string[] = [];
      const answer = (kind: 'first' | 'update' | 'select' | 'insert') => {
        if (kind === 'update' || kind === 'insert') { world.writes.push(`${name}:${kind}`); return kind === 'update' ? 1 : [1]; }
        if (name === 'portable_workspace_activations') return world.activation;
        if (name === 'tenants') return world.tenant;
        if (name === 'users') return ops.includes('whereRaw') ? world.activeUser : world.admin;
        if (name === 'roles') return [{ role_id: 'admin-role' }];
        return world.armed[name];
      };
      const chain: any = new Proxy({}, { get: (_t, prop: string) => {
        if (prop === 'then') return (res: any, rej: any) => Promise.resolve(answer(ops.includes('insert') ? 'insert' : 'select')).then(res, rej);
        if (prop === 'first') return async () => answer('first');
        if (prop === 'select') return async () => answer('select');
        if (prop === 'update') return async () => answer('update');
        if (prop === 'insert') { ops.push('insert'); return () => chain; }
        return (..._args: unknown[]) => { ops.push(prop); return chain; };
      } });
      return chain;
    },
  }),
}));
vi.mock('@alga-psa/licensing', () => ({
  activateTenantPsaLicense: vi.fn(async () => undefined),
  retainTenantPsaLicense: vi.fn(async () => ({ reference: 'lic_own', seats: 5, validUntil: new Date(Date.now() + 86_400_000) })),
  retainHostedPsaUpgradeCandidate: vi.fn(),
}));
// The package barrel needs a zod build this harness lacks; the policy function itself is the real one.
vi.mock('@alga-psa/validation', async () => ({
  validatePassword: (await import('../../../../../packages/validation/src/lib/passwordValidation')).validatePassword,
}));
vi.mock('@alga-psa/co-managed', () => ({ isCoManagedUuid: (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) }));
vi.mock('../../lib/stripe/coManagedIndependentEntitlement', () => ({ paidPsaUpgradeFromStripe: vi.fn(), createIndependentPsaStripeReader: vi.fn() }));
vi.mock('../../../../temporal-workflows/src/db/product-upgrade-operations', () => ({ initializeIndependentPsa: vi.fn(async () => { world.writes.push('initializeIndependentPsa'); }) }));

import { activatePortableWorkspaceWithTenantLicense } from '../../lib/co-managed/portableWorkspaceActivation';
import { portableRestoreSeam, type PortableRestoreSeam } from '../../lib/co-managed/portableRestoreSeam';

const TENANT = '00000000-0000-4000-8000-0000000000c1';
const OP = '00000000-0000-4000-8000-0000000000b1';
const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const GOOD_PASSWORD = 'Correct-Horse-Battery-9!';
const input = (over: Record<string, unknown> = {}) => ({ tenant: TENANT, operationId: OP, licenseToken: 'customer.jwt', administratorPassword: GOOD_PASSWORD, ...over });

function db() {
  const trx: any = { raw: async (sql: string, args: unknown[]) => { world.lockTaken.push(`${sql}|${args?.[0]}`); },
    select: () => ({ first: async () => ({ at: new Date().toISOString() }) }), fn: { now: () => 'now' } };
  return { isTransaction: false, transaction: async (work: any) => work(trx) } as any;
}
const seam: PortableRestoreSeam = {
  assertInstallationAuthority: async (...args) => world.seamAuthority(...args),
  findRestore: async () => world.restore,
};
const log = { info() {}, error() {} };
const activate = (over: Record<string, unknown> = {}) => activatePortableWorkspaceWithTenantLicense(db(), input(over), log as any, seam);

beforeEach(() => {
  world.restore = { tenant: TENANT, administrator_user_id: ADMIN };
  world.activation = undefined;
  world.tenant = { tenant: TENANT, product_code: 'psa', suspended_at: new Date(), suspended_reason: 'portable_restore_pending_activation' };
  world.activeUser = undefined;
  world.admin = { user_type: 'internal', is_inactive: true, hashed_password: '!portable-restore-disabled' };
  world.armed = {}; world.lockTaken = []; world.writes = []; world.seamAuthority = vi.fn(async () => undefined);
});

describe('portable workspace activation preconditions (A4)', () => {
  it('passes with a customer-owned licence and a valid new password; writes one receipt', async () => {
    const receipt = await activate();
    expect(receipt).toMatchObject({ tenant: TENANT, operation_id: OP, administrator_user_id: ADMIN, entitlement_source: 'tenant_license', entitlement_reference: 'lic_own', seats: 5 });
    expect(world.writes).toContain('portable_workspace_activations:insert');
    expect(world.writes).toContain('initializeIndependentPsa');
  });

  it('takes a per-tenant advisory lock', async () => {
    await activate();
    expect(world.lockTaken[0]).toContain('pg_advisory_xact_lock');
    expect(world.lockTaken[0]).toContain(`portable-restore:${TENANT}`);
  });

  it('refuses when no restore row exists', async () => {
    world.restore = undefined;
    await expect(activate()).rejects.toThrow(/pending isolated restore required/);
    expect(world.writes).toEqual([]);
  });

  it('refuses a tenant without the restore marker (a merely suspended psa tenant)', async () => {
    world.tenant = { ...world.tenant, suspended_reason: 'non_payment' };
    await expect(activate()).rejects.toThrow(/pending isolated restore required/);
  });

  it('refuses a tenant that is not psa', async () => {
    world.tenant = { ...world.tenant, product_code: 'co_managed' };
    await expect(activate()).rejects.toThrow(/pending isolated restore required/);
  });

  it('refuses when one restored user is active', async () => {
    world.activeUser = { user_id: 'someone' };
    await expect(activate()).rejects.toThrow(/restored users must remain inactive/);
  });

  it('refuses when the administrator still carries a source password', async () => {
    world.admin = { ...world.admin, hashed_password: '$2b$10$sourcehash' };
    await expect(activate()).rejects.toThrow(/original restored administrator required/);
  });

  it.each(['workflow_definitions', 'asset_maintenance_schedules', 'comments', 'online_meetings', 'availability_settings'])(
    'refuses while %s dispatch is armed (requirePausedDispatch)', async table => {
      world.armed = { [table]: { id: 1 } };
      await expect(activate()).rejects.toThrow(/restored dispatch requires review/);
      expect(world.writes).not.toContain('portable_workspace_activations:insert');
    });

  it('refuses a new password that fails the password policy, before any write', async () => {
    await expect(activate({ administratorPassword: 'short' })).rejects.toThrow(/password policy/);
    expect(world.writes).toEqual([]);
  });

  it('retry with the same operation returns the stored receipt and resets nothing', async () => {
    world.activation = { tenant: TENANT, operation_id: OP, administrator_user_id: ADMIN };
    await expect(activate()).resolves.toMatchObject({ operation_id: OP });
    expect(world.writes).toEqual([]);
  });

  it('another activation already completed under a different operation is refused', async () => {
    world.activation = { tenant: TENANT, operation_id: '00000000-0000-4000-8000-0000000000b2' };
    await expect(activate()).rejects.toThrow(/already completed/);
  });

  it('default seam fails closed until CM L7b2 supplies installation authority', async () => {
    await expect(activatePortableWorkspaceWithTenantLicense(db(), input(), log as any, portableRestoreSeam))
      .rejects.toThrow(/L7b2/);
    expect(world.writes).toEqual([]);
  });

  it('refuses a connection that is already a transaction', async () => {
    await expect(activatePortableWorkspaceWithTenantLicense({ ...db(), isTransaction: true }, input(), log as any, seam)).rejects.toThrow(/installation connection/);
  });
});
