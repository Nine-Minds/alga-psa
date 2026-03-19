import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const planDir = path.resolve(
  __dirname,
  '../../../../../ee/docs/plans/2026-03-08-microsoft-teams-enterprise-only-migration'
);
const originalPlanDir = path.resolve(
  __dirname,
  '../../../../../ee/docs/plans/2026-03-07-microsoft-teams-integration-v1'
);

const prd = fs.readFileSync(path.join(planDir, 'PRD.md'), 'utf8');
const scratchpad = fs.readFileSync(path.join(planDir, 'SCRATCHPAD.md'), 'utf8');
const features = JSON.parse(fs.readFileSync(path.join(planDir, 'features.json'), 'utf8')) as Array<{ id: string }>;
const tests = JSON.parse(fs.readFileSync(path.join(planDir, 'tests.json'), 'utf8')) as Array<{ id: string }>;

describe('Teams enterprise-only migration plan contract', () => {
  it('T001/T002: keeps the migration in a dedicated follow-on plan folder instead of rewriting the original Teams v1 plan', () => {
    expect(fs.existsSync(planDir)).toBe(true);
    expect(fs.existsSync(path.join(originalPlanDir, 'PRD.md'))).toBe(true);
    expect(prd).toContain('This plan follows `2026-03-07-microsoft-teams-integration-v1` rather than replacing it.');
    expect(prd).toContain('follow-on migration plan');
  });

  it('T003/T004: references the original Teams v1 plan as historical context and keeps migration framing separate from product rollout history', () => {
    expect(prd).toContain('2026-03-07-microsoft-teams-integration-v1');
    expect(prd).toContain('The original Teams v1 plan remains as the product-history artifact; this plan becomes the migration-history artifact.');
  });

  it('T005/T006/T007/T008: records the CE ownership hotspots and the Entra EE-boundary precedent in the scratchpad', () => {
    expect(scratchpad).toContain('IntegrationsSettingsPage.tsx');
    expect(scratchpad).toContain('teamsActions.ts');
    expect(scratchpad).toContain('server/src/app/api/integrations/entra/route.ts');
    expect(scratchpad).toContain('The Entra CE-stub plus EE-delegation pattern is the precedent');
  });

  it('T009/T010/T011/T012: treats Teams as unreleased disposable data while keeping shared Microsoft profiles as retained shared infrastructure', () => {
    expect(prd).toContain('Teams should be treated as unreleased and internal while this migration is in progress.');
    expect(prd).toContain('Current local/dev Teams data does not need preservation.');
    expect(prd).toContain('Shared Microsoft profiles remain shared because they are used by non-Teams Microsoft integrations');
    expect(scratchpad).toContain('Existing local/dev Teams data is disposable; no production-style backfill path is required.');
  });

  it('T013/T014/T015/T016: defines teams-integration-ui as the only new rollout flag and distinguishes fresh CE versus fresh EE install targets', () => {
    expect(prd).toContain('The new feature flag is `teams-integration-ui`.');
    expect(prd).toContain('Gate Teams UI and runtime in EE with one tenant feature flag: `teams-integration-ui`.');
    expect(prd).toContain('Fresh CE installs do not create Teams schema.');
    expect(prd).toContain('Fresh EE installs do create Teams schema.');
  });

  it('T017/T018: distinguishes migration work from the already-shared Microsoft profile capability set', () => {
    expect(prd).toContain('Keep shared Microsoft profiles and Microsoft consumer bindings in shared code.');
    expect(prd).toContain('Moving shared Microsoft profile management into EE');
  });

  it('T019/T020: keeps stable feature and test IDs in the migration inventories', () => {
    const featureIds = features.map((feature) => feature.id);
    const testIds = tests.map((test) => test.id);

    expect(featureIds.length).toBeGreaterThan(0);
    expect(testIds.length).toBeGreaterThan(0);
    expect(new Set(featureIds).size).toBe(featureIds.length);
    expect(new Set(testIds).size).toBe(testIds.length);
    expect(featureIds[0]).toBe('F001');
    expect(testIds[0]).toBe('T001');
  });

  it('T055/T056: records the canonical CE-unavailable and EE-flag-disabled wrapper copy in the migration scratchpad', () => {
    expect(scratchpad).toContain(
      'Canonical unavailable copy for CE wrappers: `Microsoft Teams integration is only available in Enterprise Edition.`'
    );
    expect(scratchpad).toContain(
      'Canonical disabled copy for EE flag-off wrappers: `Microsoft Teams integration is disabled for this tenant.`'
    );
  });

  it('T161/T162: documents which Teams public routes remain addressable as CE stubs and which hard-stop when unavailable', () => {
    expect(scratchpad).toContain('/api/teams/bot/messages');
    expect(scratchpad).toContain('/api/teams/message-extension/query');
    expect(scratchpad).toContain('/api/teams/quick-actions');
    expect(scratchpad).toContain('/api/teams/package');
    expect(scratchpad).toContain('The personal tab UI at `/teams/tab` remains a hard-stop page when Teams is unavailable');
  });

  it('T365/T366/T415/T416/T444: keeps the scratchpad and PRD aligned on CE invisibility plus the focused validation runbooks for settings, routes, actions, auth, notifications, and schema', () => {
    expect(prd).toContain('Teams is invisible and unavailable in CE');
    expect(prd).toContain('Teams admin setup appears only in `Settings -> Integrations -> Communication`');
    expect(scratchpad).toContain('settings visibility tests for CE vs EE flag-off vs EE flag-on');
    expect(scratchpad).toContain('Teams route wrapper tests for unavailable, disabled, and delegated cases');
    expect(scratchpad).toContain('Teams action wrapper tests for unavailable, disabled, and delegated cases');
    expect(scratchpad).toContain('migration tests for fresh CE vs fresh EE schema');
    expect(scratchpad).toContain('Validate EE ownership/package boundaries with:');
    expect(scratchpad).toContain('Validate auth and notification wrapper behavior with:');
  });

  it('T417/T418: keeps acceptance scoped to CE invisibility, EE Communication placement, and EE-owned schema boundaries', () => {
    expect(prd).toContain('CE settings show no Teams integration surface.');
    expect(prd).toContain('EE settings show Teams only in `Communication`, and only when `teams-integration-ui` is enabled.');
    expect(prd).toContain('Fresh CE installs do not create Teams schema.');
    expect(prd).toContain('Fresh EE installs do create Teams schema.');
  });
});
