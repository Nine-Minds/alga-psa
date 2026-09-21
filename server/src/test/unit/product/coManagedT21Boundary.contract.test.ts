import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../');
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

/**
 * T21 boundary inventory. The release boundary is presentation-only and must
 * wrap every relocated co-managed surface so disabling it removes the feature
 * UI without touching backend authorization (T22).
 */
describe('co-managed T21 boundary inventory', () => {
  it('gates the client integration, account pool editor, and legacy adapters', () => {
    const integration = read('server/src/components/co-managed/CoManagedClientIntegration.tsx');
    expect(integration).toContain("useFeatureFlag('release-v1-6-feature'");
    expect(integration).toContain('children(null)');

    const account = read('ee/server/src/components/settings/account/AccountManagement.tsx');
    expect(account).toContain('CoManagedFeatureBoundary');
    expect(account).toContain('CoManagedPoolEditor');

    for (const page of [
      'server/src/app/msp/co-managed/page.tsx',
      'server/src/app/msp/co-management/page.tsx',
      'server/src/app/msp/co-management/sla/page.tsx',
      'server/src/app/msp/co-management/administration/page.tsx',
      'server/src/app/msp/co-management/departure/page.tsx',
    ]) {
      const source = read(page);
      expect(source, page).toContain('CoManagedFeatureBoundary');
      expect(source, page).toContain('CoManagedLegacyRedirect');
    }

    const legacy = read('server/src/components/co-managed/CoManagedLegacyRedirect.tsx');
    // The adapter performs no discovery while the boundary is unavailable.
    expect(legacy).toMatch(/if \(!usable\) return null/);
  });

  it('keeps ordinary account and client surfaces outside the boundary', () => {
    const account = read('ee/server/src/components/settings/account/AccountManagement.tsx');
    // The boundary wraps only the co-managed section; subscription controls
    // remain in the ordinary document flow.
    expect(account).toMatch(/<CoManagedFeatureBoundary>[\s\S]*?<CoManagedPoolEditor showTotals \/>/);
    const clientDetails = read('packages/clients/src/components/clients/ClientDetails.tsx');
    // The ordinary client renders with no feature slots when the callback is absent.
    expect(clientDetails).toContain('renderClientBody(null)');
  });

  it('keeps backend resolution free of release-flag checks', () => {
    for (const file of [
      'packages/co-managed/src/managementPolicy.ts',
      'server/src/lib/actions/coManagedActions.ts',
    ]) {
      expect(read(file), file).not.toContain('release-v1-6-feature');
    }
  });
});
