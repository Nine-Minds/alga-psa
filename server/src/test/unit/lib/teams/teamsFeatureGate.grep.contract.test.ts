import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../..');
const repoPath = (relativePath: string): string => path.join(repoRoot, relativePath);

const GATE_MODULE = 'ee/packages/microsoft-teams/src/lib/teams/teamsFeatureGate.ts';

// Teams server execution sites that share the release feature gate.
const MIGRATED_FILES = [
  'ee/packages/microsoft-teams/src/lib/actions/meetings/meetingCapabilityActions.ts',
  'ee/packages/microsoft-teams/src/lib/teams/teamsAvailability.ts',
  'ee/packages/microsoft-teams/src/lib/teams/resolveTeamsTenantContext.ts',
  'ee/packages/microsoft-teams/src/lib/meetings/meetingConfig.ts',
  'ee/packages/microsoft-teams/src/lib/notifications/teamsNotificationDelivery.ts',
];

describe('Teams feature gate centralization', () => {
  it('uses release-v1-5-feature as the canonical gate', () => {
    const source = fs.readFileSync(repoPath(GATE_MODULE), 'utf8');
    expect(source).toMatch(/export async function tenantHasTeamsFeatureAccess\(/);
    expect(source).toMatch(/export async function assertTeamsFeatureAccess\(/);
    expect(source).toContain('RELEASE_V1_5_FEATURE_FLAG');
    expect(source).not.toContain('tenant_addons');
  });

  it('does not query tenant_addons from migrated gate sites', () => {
    for (const relativePath of MIGRATED_FILES) {
      const source = fs.readFileSync(repoPath(relativePath), 'utf8');

      // No inline function definition (imports and call sites are allowed).
      expect(source, `${relativePath} still defines a local tenantHasTeamsFeatureAccess`).not.toMatch(
        /function\s+tenantHasTeamsFeatureAccess/
      );

      expect(source, `${relativePath} still queries .table('tenant_addons')`).not.toContain(
        ".table('tenant_addons')"
      );
    }
  });

  it('imports the shared feature gate wherever direct feature access is checked', () => {
    const referencingFiles = MIGRATED_FILES.filter((relativePath) =>
      fs.readFileSync(repoPath(relativePath), 'utf8').includes('tenantHasTeamsFeatureAccess')
    );

    expect(referencingFiles).toHaveLength(5);

    for (const relativePath of referencingFiles) {
      const source = fs.readFileSync(repoPath(relativePath), 'utf8');
      expect(source, `${relativePath} references the gate without importing teamsFeatureGate`).toMatch(
        /from ['"][^'"]*teamsFeatureGate['"]/
      );
    }
  });
});
