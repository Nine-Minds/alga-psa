import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../..');
const repoPath = (relativePath: string): string => path.join(repoRoot, relativePath);

const GATE_MODULE = 'ee/packages/microsoft-teams/src/lib/teams/teamsAddOnGate.ts';

// The Teams add-on gate sites that F063 centralizes onto teamsAddOnGate.
const MIGRATED_FILES = [
  'ee/packages/microsoft-teams/src/lib/actions/meetings/meetingCapabilityActions.ts',
  'ee/packages/microsoft-teams/src/lib/teams/teamsAvailability.ts',
  'ee/packages/microsoft-teams/src/lib/teams/resolveTeamsTenantContext.ts',
  'ee/packages/microsoft-teams/src/lib/meetings/meetingConfig.ts',
  'ee/packages/microsoft-teams/src/lib/notifications/teamsNotificationDelivery.ts',
];

describe('teams add-on gate centralization (F063)', () => {
  it('T101: teamsAddOnGate is the single definition of the add-on gate helpers', () => {
    const source = fs.readFileSync(repoPath(GATE_MODULE), 'utf8');
    expect(source).toMatch(/export async function tenantHasTeamsAddOn\(/);
    expect(source).toMatch(/export async function getTeamsAddOnState\(/);
    expect(source).toMatch(/export async function assertTeamsAddOn\(/);
    // The canonical tenant_addons query lives here.
    expect(source).toContain(".table('tenant_addons')");
  });

  it('T101: no migrated gate site redefines tenantHasTeamsAddOn or re-queries tenant_addons directly', () => {
    for (const relativePath of MIGRATED_FILES) {
      const source = fs.readFileSync(repoPath(relativePath), 'utf8');

      // No inline function definition (imports and call sites are allowed).
      expect(source, `${relativePath} still defines a local tenantHasTeamsAddOn`).not.toMatch(
        /function\s+tenantHasTeamsAddOn/
      );

      // No direct .table('tenant_addons') read. resolveTeamsTenantContext still
      // joins tenant_addons for cross-tenant discovery via tenantJoin(..., 'tenant_addons as addons', ...),
      // which is a distinct query shape and never a .table('tenant_addons') entitlement probe.
      expect(source, `${relativePath} still queries .table('tenant_addons')`).not.toContain(
        ".table('tenant_addons')"
      );
    }
  });

  it('T101: every migrated site that references the gate imports it from teamsAddOnGate', () => {
    const referencingFiles = MIGRATED_FILES.filter((relativePath) =>
      fs.readFileSync(repoPath(relativePath), 'utf8').includes('tenantHasTeamsAddOn')
    );

    // The four function-based copies migrate; resolveTeamsTenantContext keeps its JOIN
    // and does not reference the helper, so it is legitimately excluded here.
    expect(referencingFiles).toHaveLength(4);

    for (const relativePath of referencingFiles) {
      const source = fs.readFileSync(repoPath(relativePath), 'utf8');
      expect(source, `${relativePath} references tenantHasTeamsAddOn without importing teamsAddOnGate`).toMatch(
        /from ['"][^'"]*teamsAddOnGate['"]/
      );
    }
  });
});
