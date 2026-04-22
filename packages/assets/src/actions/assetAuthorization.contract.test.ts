import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readActionSource = () => readFileSync(path.resolve(__dirname, 'assetActions.ts'), 'utf8');

describe('asset authorization kernel contracts', () => {
  const source = readActionSource();

  it('T021: keeps selected asset surfaces on shared kernel with baseline + bundle narrowing composition', () => {
    expect(source).toContain('async function resolveAssetAuthorizationRecords(');
    expect(source).toContain('async function createAssetReadAuthorizationContext(');
    expect(source).toContain('async function authorizeAssetReadDecision(');
    expect(source).toContain('async function assertAssetReadAllowed(');
    expect(source).toContain('export const getAsset = withAuth(async (user, { tenant }, asset_id: string)');
    expect(source).toContain('export const getAssetDetailBundle = withAuth(async (user, { tenant }, asset_id: string)');
    expect(source).toContain('export const listAssets = withAuth(async (user, { tenant }, params: AssetQueryParams)');
    expect(source).toContain('buildAuthorizationAwarePage<any>({');
    expect(source).toContain('authorizeRecord: async (asset) => {');
    expect(source).toContain('total: authorizedPage.total,');
    expect(source).toContain('builtinProvider: new BuiltinAuthorizationKernelProvider(),');
    expect(source).toContain('bundleProvider: new BundleAuthorizationKernelProvider({');
    expect(source).toContain('return await resolveBundleNarrowingRulesForEvaluation(trx, input);');
    expect(source).toContain('record: assetRecords.get(asset.asset_id),');
  });
});
