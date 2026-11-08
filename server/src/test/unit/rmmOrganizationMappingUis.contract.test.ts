import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T088 / F094: every RMM organization-mapping UI must confirm a client change
 * with the affected device count, and offer the People mode select.
 *
 * Source-level because three of the five managers live in `ee/server` and two
 * in `packages/integrations`, with no shared harness that can mount all five.
 * The failure this guards is specific and was real: three managers imported
 * `RmmOrganizationClientChangeDialog` and set `pendingClientChange` but never
 * rendered the dialog, so changing a mapped organization's client returned
 * early with no save and no feedback.
 */
const REPO_ROOT = path.resolve(__dirname, '../../../..');

const MANAGERS: Array<{ provider: string; file: string }> = [
  { provider: 'tactical', file: 'packages/integrations/src/components/settings/integrations/TacticalRmmIntegrationSettings.tsx' },
  { provider: 'datto', file: 'ee/server/src/components/settings/integrations/DattoRmmIntegrationSettings.tsx' },
  { provider: 'tanium', file: 'ee/server/src/components/settings/integrations/TaniumIntegrationSettings.tsx' },
  { provider: 'levelio', file: 'ee/server/src/components/settings/integrations/LevelIoIntegrationSettings.tsx' },
  { provider: 'huntress', file: 'ee/server/src/components/settings/integrations/huntress/OrganizationMappingManager.tsx' },
  { provider: 'ninjaone', file: 'ee/server/src/components/settings/integrations/ninjaone/OrganizationMappingManager.tsx' },
];

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

describe('RMM organization mapping UIs', () => {
  it.each(MANAGERS)('$provider renders the client-change confirmation dialog', ({ file }) => {
    const text = source(file);

    expect(text).toMatch(/import \{ RmmOrganizationClientChangeDialog \}/);
    // Importing and staging a pending change is not enough: the element has to
    // be in the tree, or the early return strands the user.
    expect(text).toMatch(/<RmmOrganizationClientChangeDialog\b/);
    expect(text).toMatch(/isOpen=\{Boolean\(pendingClientChange\)\}/);
    expect(text).toMatch(/onCancel=\{\(\) => setPendingClientChange\(null\)\}/);
    // The confirm branch must actually perform the update it deferred.
    expect(text).toMatch(/onConfirm=\{\(\) => \{[\s\S]{0,400}?pendingClientChange/);
  });

  it.each(MANAGERS)('$provider offers the People mode select', ({ file }) => {
    const text = source(file);

    expect(text).toMatch(/buildRmmPeopleModeOptions/);
    expect(text).toMatch(/id=\{`rmm-org-people-mode-\$\{\w+\.mapping_id\}`\}/);
    expect(text).toMatch(/contact_assignment_mode/);
  });

  it.each(MANAGERS)('$provider offers the per-organization billing profile select', ({ file }) => {
    const text = source(file);

    expect(text).toMatch(/import \{ RmmOrganizationBillingProfileSelect \}/);
    expect(text).toMatch(/<RmmOrganizationBillingProfileSelect\b/);
    expect(text).toMatch(/onChange=\{\(billingProfileId\) =>/);
  });

  it('T132: the billing profile select hides itself below two profiles', () => {
    const text = source('packages/integrations/src/components/settings/integrations/RmmOrganizationBillingProfileSelect.tsx');

    expect(text).toContain('if (profiles.length < 2) return null;');
    expect(text).toMatch(/id=\{`rmm-org-billing-profile-\$\{mappingId\}`\}/);
    expect(text).toContain('listRmmOrganizationBillingProfiles({ clientId })');
  });

  it.each([
    ['tactical', 'packages/integrations/src/actions/integrations/tacticalRmmActions.ts'],
    ['datto', 'ee/server/src/lib/actions/integrations/dattoRmmActions.ts'],
    ['tanium', 'ee/server/src/lib/actions/integrations/taniumActions.ts'],
    ['levelio', 'ee/server/src/lib/actions/integrations/levelIoActions.ts'],
    ['huntress', 'ee/server/src/lib/actions/integrations/huntressActions.ts'],
    ['ninjaone', 'ee/server/src/lib/actions/integrations/ninjaoneActions.ts'],
  ])('T135/T136: %s moves the organization\u2019s assets in the mapping update transaction', (_provider, file) => {
    const text = source(file);

    expect(text).toMatch(/moveRmmOrganizationAssets \} from '@alga-psa\/shared\/rmm\/moveRmmOrganizationAssets'/);
    // Same `trx` as the mapping write, so a failure rolls back both rather
    // than leaving the mapping pointed at a client its devices never reached.
    expect(text).toMatch(/await moveRmmOrganizationAssets\(trx, tenant, \{/);
    // And only when the client actually changed.
    const call = text.slice(text.indexOf('await moveRmmOrganizationAssets'));
    expect(call).toMatch(/newClientId/);
  });

  it('T137: the dialog reads its count from countRmmOrganizationAssets and cancels cleanly', () => {
    const text = source('packages/integrations/src/components/settings/integrations/RmmOrganizationClientChangeDialog.tsx');

    expect(text).toMatch(/countRmmOrganizationAssets\(\{ mappingId \}\)/);
    expect(text).toContain('id="rmm-org-client-change-dialog"');
    expect(text).toMatch(/integrations\.rmm\.clientChange\.message/);
    // Cancel is a pure dismissal: no mapping write happens on that branch.
    expect(text).toMatch(/onClose=\{onCancel\}/);
    expect(text).not.toMatch(/updateRmmOrganizationMapping|update\w*OrganizationMapping/);
  });
});
