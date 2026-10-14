import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

/**
 * FR-F3 — an alert ticket's billing profile.
 *
 * The ticket's client comes from the device, and FR-G5 lets a device be moved
 * to another client by hand. The RMM organization mapping may still point at
 * the client it came from, so its profile cannot be written straight onto the
 * ticket: that billed client B's work to client A's profile.
 */
describe('alert ticket billing profile', () => {
  it('checks every candidate against the client the ticket is raised for', () => {
    const source = readRepoFile('shared/rmm/alerts/ticketCreator.ts');

    expect(source).toContain('assertBillingProfileForClient');
    expect(source).toContain('async function profileForClient(');
    expect(source).toContain('await profileForClient(trx, tenantId, params.clientId, params.mappingBillingProfileId ?? null)');
    // Nothing writes the mapping's id directly any more.
    expect(source).not.toMatch(/params\.mappingBillingProfileId\s*\n?\s*\?\?\s*\(params\.assetId/);
  });

  it('falls back instead of failing the ticket', () => {
    const source = readRepoFile('shared/rmm/alerts/ticketCreator.ts');
    const helper = source.slice(source.indexOf('async function profileForClient('));
    expect(helper).toContain('catch {');
    expect(helper).toContain('return null;');
  });

  it('every mapping action resolves the profile through the shared rule', () => {
    const actions = [
      'packages/integrations/src/actions/integrations/tacticalRmmActions.ts',
      'ee/server/src/lib/actions/integrations/ninjaoneActions.ts',
      'ee/server/src/lib/actions/integrations/huntressActions.ts',
      'ee/server/src/lib/actions/integrations/taniumActions.ts',
      'ee/server/src/lib/actions/integrations/levelIoActions.ts',
    ];
    for (const file of actions) {
      const source = readRepoFile(file);
      expect(source, file).toContain("from '@alga-psa/shared/rmm/mappingBillingProfile'");
      expect(source, file).toContain('await resolveMappingBillingProfileId(trx, tenant, {');
      // The unchecked assignment is gone from all five.
      expect(source, file).not.toMatch(/billing_profile_id = (input\.billingProfileId|updates\.billing_profile_id)/);
    }
  });
});
