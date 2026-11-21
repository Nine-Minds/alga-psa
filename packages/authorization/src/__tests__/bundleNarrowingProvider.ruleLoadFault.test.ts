import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// T006 (asset half, plus the shared loader itself): a bundle-rule load that throws denies, through the
// real kernel and the real bundle provider. Only the database and the rule query are faked.
const state = vi.hoisted(() => ({
  resolveBundleRules: async (..._args: any[]) => [] as any[],
  loadCalls: 0,
}));

vi.mock('@alga-psa/db', () => {
  const query: any = {
    where: () => query,
    whereIn: () => query,
    orderBy: () => query,
    select: () => query,
    first: async () => ({ asset_id: 'asset-1', client_id: 'client-1' }),
    then: (resolve: (rows: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve([]).then(resolve, reject),
  };
  return { tenantDb: () => ({ table: () => query }) };
});
vi.mock('../bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: (...args: any[]) => {
    state.loadCalls += 1;
    return state.resolveBundleRules(...args);
  },
}));

import {
  BuiltinAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
} from '../kernel';
import { BUNDLE_RULES_UNAVAILABLE_CODE, createBundleNarrowingProvider } from '../bundles/narrowingProvider';
import {
  createAssetReadContext,
  filterReadableAssets,
  isAssetClientReadAllowed,
  isAssetReadAllowed,
  loadReadableAssetById,
} from '../assetReadAuthorization';

const conn = {} as any;
const user = { user_id: 'u1', user_type: 'internal' as const, roles: [{ role_id: 'r1' }] };
const asset = { asset_id: 'asset-1', client_id: 'client-1' };
const subject = { tenant: 't1', userId: 'u1', userType: 'internal' as const, roleIds: ['r1'], teamIds: [], managedUserIds: [] };

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  state.resolveBundleRules = async () => [];
  state.loadCalls = 0;
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  errorLog.mockRestore();
});

function failRuleLoading() {
  state.resolveBundleRules = async () => { throw new Error('bundle lookup failed'); };
}

describe('createBundleNarrowingProvider', () => {
  const authorize = () =>
    createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      bundleProvider: createBundleNarrowingProvider(conn),
      rbacEvaluator: async () => true,
    }).authorizeResource({
      subject,
      resource: { type: 'asset', action: 'read', id: 'asset-1' },
      record: { id: 'asset-1', clientId: 'client-1' },
      requestCache: new RequestLocalAuthorizationCache(),
      knex: conn,
    });

  it('leaves the decision alone when the rules load and none apply', async () => {
    const decision = await authorize();
    expect(decision.allowed).toBe(true);
    expect(state.loadCalls).toBe(1);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('applies loaded rules exactly as the kernel bundle provider does', async () => {
    state.resolveBundleRules = async () => [
      { id: 'r1', resource: 'asset', action: 'read', templateKey: 'selected_clients', selectedClientIds: ['other-client'] },
    ];
    const decision = await authorize();
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.map((reason) => reason.code)).toContain('bundle_template_denied');
  });

  it('denies with a reason naming the fault when the rules cannot be loaded', async () => {
    failRuleLoading();
    const decision = await authorize();
    expect(decision.allowed).toBe(false);
    expect(decision.scope.denied).toBe(true);
    expect(decision.reasons.map((reason) => reason.code)).toContain(BUNDLE_RULES_UNAVAILABLE_CODE);
  });

  it('logs the fault once per provider, not once per record', async () => {
    failRuleLoading();
    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      bundleProvider: createBundleNarrowingProvider(conn),
      rbacEvaluator: async () => true,
    });
    for (const id of ['a', 'b', 'c']) {
      const decision = await kernel.authorizeResource({ subject, resource: { type: 'asset', action: 'read', id }, record: { id } });
      expect(decision.allowed).toBe(false);
    }
    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});

describe('asset reads when bundle rules cannot be loaded (T006)', () => {
  it('allows the same reads while rules load, so the denial below is the fault and nothing else', async () => {
    const context = await createAssetReadContext(conn, 't1', user);
    expect(await isAssetReadAllowed(conn, 't1', context, asset)).toBe(true);
    expect(await filterReadableAssets(conn, 't1', context, [asset])).toEqual([asset]);
    expect(await isAssetClientReadAllowed(conn, context, 'client-1')).toBe(true);
    expect(await loadReadableAssetById(conn, 't1', user, 'asset-1')).toEqual(asset);
  });

  it('denies every asset read', async () => {
    failRuleLoading();
    const context = await createAssetReadContext(conn, 't1', user);
    expect(await isAssetReadAllowed(conn, 't1', context, asset)).toBe(false);
    expect(await filterReadableAssets(conn, 't1', context, [asset, { asset_id: 'asset-2', client_id: 'client-2' }])).toEqual([]);
    expect(await isAssetClientReadAllowed(conn, context, 'client-1')).toBe(false);
    expect(await loadReadableAssetById(conn, 't1', user, 'asset-1')).toBeNull();
    expect(state.loadCalls).toBeGreaterThan(0);
  });
});
