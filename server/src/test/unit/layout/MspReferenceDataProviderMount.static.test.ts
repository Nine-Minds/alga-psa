import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The shared reference-list cache must be mounted once for every MSP page. Lists are edited on
// screens outside the workspace route layouts (Settings > Ticketing > Boards, Settings > Tags,
// project status settings, onboarding), and `invalidateReferenceList` only reaches mounted
// providers. Mounted per workspace route segment, those invalidations were silently dropped.
const srcDir = path.resolve(process.cwd(), 'src');
const mspLayoutClient = fs.readFileSync(path.join(srcDir, 'app/msp/MspLayoutClient.tsx'), 'utf8');
const workspaceProviders = fs.readFileSync(
  path.join(srcDir, 'components/layout/WorkspaceProviders.tsx'),
  'utf8'
);

describe('MspReferenceDataProvider mount point', () => {
  it('is mounted in the MSP root layout, keyed by tenant and user from the session', () => {
    expect(mspLayoutClient).toContain('<MspReferenceDataProvider');
    expect(mspLayoutClient).toContain(
      'scope={referenceDataScope(session?.user?.tenant, session?.user?.id)}'
    );
  });

  it('wraps the whole MSP page tree, including the root TagProvider', () => {
    const open = mspLayoutClient.indexOf('<MspReferenceDataProvider');
    const close = mspLayoutClient.indexOf('</MspReferenceDataProvider>');
    expect(open).toBeLessThan(mspLayoutClient.indexOf('<TagProvider>'));
    expect(close).toBeGreaterThan(mspLayoutClient.indexOf('</TagProvider>'));
  });

  it('is not mounted per workspace route segment', () => {
    expect(workspaceProviders).not.toContain('MspReferenceDataProvider');
  });
});
