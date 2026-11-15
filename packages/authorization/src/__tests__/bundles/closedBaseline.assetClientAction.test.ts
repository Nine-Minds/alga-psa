import { beforeEach, describe, expect, it, vi } from 'vitest';

// The client-level asset check must not drop rules before the provider sees them: the provider derives closed
// bundles from the full rule list.
const state = vi.hoisted(() => ({ rules: [] as any[] }));

vi.mock('@alga-psa/db', () => ({ tenantDb: () => ({ table: () => ({}) }) }));
vi.mock('../../bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: async () => state.rules,
}));

import { RequestLocalAuthorizationCache } from '../../kernel';
import { isAssetClientActionAllowed } from '../../assetReadAuthorization';

const context: any = {
  subject: { tenant: 't1', userId: 'u1', userType: 'internal', roleIds: [], teamIds: [], managedUserIds: [] },
  requestCache: new RequestLocalAuthorizationCache(),
};
const rule = (id: string, resource: string, action: string, templateKey: string, extra: any = {}) => ({
  id, bundleId: 'closed-1', revisionId: 'rev-1', baseline: 'closed', resource, action, templateKey, ...extra,
});

describe('isAssetClientActionAllowed with closed bundles', () => {
  beforeEach(() => {
    context.requestCache = new RequestLocalAuthorizationCache();
  });

  it('(a) does not false-deny when the closed bundle names asset:read under a non-client template', async () => {
    state.rules = [rule('r1', 'asset', 'read', 'same_team'), rule('r2', 'client', 'read', 'same_client')];
    expect(await isAssetClientActionAllowed({} as any, 't1', context, 'c1', 'read')).toBe(true);
  });

  it('(b) still denies when a closed bundle with only non-client templates does not name the action', async () => {
    state.rules = [rule('r1', 'asset', 'read', 'same_team')];
    expect(await isAssetClientActionAllowed({} as any, 't1', context, 'c1', 'update')).toBe(false);
    // ...and a closed bundle on an unrelated resource denies too
    state.rules = [rule('r2', 'ticket', 'read', 'assigned')];
    context.requestCache = new RequestLocalAuthorizationCache();
    expect(await isAssetClientActionAllowed({} as any, 't1', context, 'c1', 'read')).toBe(false);
  });

  it('keeps client-scope templates narrowing, and non-client templates non-narrowing', async () => {
    state.rules = [rule('r1', 'asset', 'read', 'selected_clients', { selectedClientIds: ['other'] })];
    expect(await isAssetClientActionAllowed({} as any, 't1', context, 'c1', 'read')).toBe(false);
    state.rules = [rule('r1', 'asset', 'read', 'assigned', { baseline: 'open' })];
    context.requestCache = new RequestLocalAuthorizationCache();
    expect(await isAssetClientActionAllowed({} as any, 't1', context, 'c1', 'read')).toBe(true);
  });
});
