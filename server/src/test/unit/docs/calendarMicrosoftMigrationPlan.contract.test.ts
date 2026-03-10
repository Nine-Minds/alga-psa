import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const planDir = path.resolve(
  __dirname,
  '../../../../../ee/docs/plans/2026-03-09-calendar-sync-enterprise-migration-and-microsoft-profile-explicit-bindings'
);
const priorTeamsPlanDir = path.resolve(
  __dirname,
  '../../../../../ee/docs/plans/2026-03-08-microsoft-teams-enterprise-only-migration'
);
const priorNamedProfilesPlanDir = path.resolve(
  __dirname,
  '../../../../../ee/docs/plans/2026-03-07-microsoft-teams-integration-v1'
);

const prd = fs.readFileSync(path.join(planDir, 'PRD.md'), 'utf8');
const scratchpad = fs.readFileSync(path.join(planDir, 'SCRATCHPAD.md'), 'utf8');
const features = JSON.parse(
  fs.readFileSync(path.join(planDir, 'features.json'), 'utf8')
) as Array<{ id: string }>;
const tests = JSON.parse(fs.readFileSync(path.join(planDir, 'tests.json'), 'utf8')) as Array<{ id: string }>;
const integrationsCalendarTest = fs.readFileSync(
  path.resolve(
    __dirname,
    '../components/integrations/IntegrationsSettingsPage.calendar.test.tsx'
  ),
  'utf8'
);
const userProfileCalendarTest = fs.readFileSync(
  path.resolve(__dirname, '../components/profile/UserProfile.calendar.contract.test.ts'),
  'utf8'
);

describe('Calendar and Microsoft migration plan contract', () => {
  it('T025-T032/T393-T396: keeps edition-safe ownership planning in one follow-on plan and cross-references the prior Teams and named-profile work', () => {
    expect(fs.existsSync(planDir)).toBe(true);
    expect(fs.existsSync(path.join(priorTeamsPlanDir, 'PRD.md'))).toBe(true);
    expect(fs.existsSync(path.join(priorNamedProfilesPlanDir, 'PRD.md'))).toBe(true);
    expect(prd).toContain('follow-on migration plan');
    expect(prd).toContain('2026-03-08-microsoft-teams-enterprise-only-migration');
    expect(prd).toContain('shared binding table as shared infrastructure');
    expect(scratchpad).toContain('Prior Teams EE-boundary follow-on plan');
    expect(scratchpad).toContain('Prior Microsoft profile and Teams plan');
    expect(scratchpad).toContain('calendarAvailability.ts');
  });

  it('T033-T048/T397-T400: records the calendar and Microsoft file inventories, CE stub or EE delegator rules, and the final acceptance matrix', () => {
    expect(scratchpad).toContain('Current shared settings composition');
    expect(scratchpad).toContain('Current shared Microsoft profile UI');
    expect(scratchpad).toContain('Current shared calendar callback routes');
    expect(scratchpad).toContain('Calendar public entry routes also include');
    expect(scratchpad).toContain('CE-stub plus EE-delegation pattern');
    expect(scratchpad).toContain('Added calendar and Microsoft edition-contract matrices');
    expect(scratchpad).toContain('final acceptance matrix');
    expect(prd).toContain('Calendar OAuth callback routes are CE stubs or EE delegators.');
    expect(prd).toContain('Tests cover CE unavailable behavior, EE active behavior, explicit binding behavior, and migration/ownership regressions.');
  });

  it('T357-T382: documents shared binding infrastructure, EE calendar ownership, unsupported edge states, and the schema/runbook inventories', () => {
    expect(prd).toContain('`microsoft_profile_consumer_bindings` remains shared.');
    expect(prd).toContain('credential records stay shared, but consumer usage is explicit and edition-aware.');
    expect(scratchpad).toContain('The concrete EE calendar runtime now lives under `packages/ee/src/lib/services/calendar/*`');
    expect(scratchpad).toContain('The EE runtime ownership contract now explicitly covers:');
    expect(scratchpad).toContain('Unsupported Edge States / Manual Cleanup');
    expect(scratchpad).toContain('Tenants with an active Microsoft calendar provider but no explicit `calendar` binding');
    expect(scratchpad).toContain('server/migrations/20260307143000_create_microsoft_profile_consumer_bindings.cjs');
    expect(scratchpad).toContain('server/src/test/unit/microsoft/microsoftConsumerSchema.contract.test.ts');
  });

  it('T391/T392: replaces CE-calendar-presence assertions with CE-hidden and fallback-aware calendar visibility tests', () => {
    expect(integrationsCalendarTest).toContain('T391/T392: replaces old CE calendar-visibility assertions with CE-hidden regression coverage');
    expect(integrationsCalendarTest).toContain('keeps Calendar visible in EE through the enterprise wrapper');
    expect(integrationsCalendarTest).not.toContain('shows the Calendar category in CE');

    expect(userProfileCalendarTest).toContain('gates the Calendar tab through the shared calendar availability helper and the enterprise wrapper');
    expect(userProfileCalendarTest).toContain('resolveUserProfileTab(tabParam, isCalendarTabAvailable)');
    expect(userProfileCalendarTest).toContain(
      `expect(source).not.toContain("import { CalendarIntegrationsSettings } from '@alga-psa/integrations/components';");`
    );
  });

  it('T401-T404/T427-T432: keeps the plan artifacts self-contained with stable IDs, validator coverage, and focused suite runbooks', () => {
    expect(new Set(features.map((feature) => feature.id)).size).toBe(features.length);
    expect(new Set(tests.map((test) => test.id)).size).toBe(tests.length);
    expect(features[0]?.id).toBe('F001');
    expect(tests[0]?.id).toBe('T001');
    expect(scratchpad).toContain('python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py');
    expect(scratchpad).toContain('Focused validation suites expected for this migration:');
    expect(scratchpad).toContain('settings/profile visibility tests for CE versus EE calendar entrypoints');
    expect(scratchpad).toContain('calendar callback and webhook wrapper tests for unavailable versus delegated behavior');
  });

  it('T405-T426: keeps CE, EE, and regression review checklists explicit in the scratchpad', () => {
    expect(scratchpad).toContain('CE review checklist:');
    expect(scratchpad).toContain('No Calendar category remains visible in `Settings -> Integrations`.');
    expect(scratchpad).toContain('Microsoft profile UI shows only MSP SSO-oriented copy and one binding control.');
    expect(scratchpad).toContain('EE review checklist:');
    expect(scratchpad).toContain('Calendar settings remain fully configurable from `Settings -> Integrations -> Calendar`.');
    expect(scratchpad).toContain('Microsoft profile UI shows MSP SSO, Email, Calendar, and Teams consumer controls.');
    expect(scratchpad).toContain('Regression checklist:');
    expect(scratchpad).toContain('Teams EE cleanup remains intact; no shared Teams runtime is reintroduced.');
    expect(scratchpad).toContain('Email binding strategy is explicit and not left to compatibility-default assumptions.');
    expect(scratchpad).toContain('Archive/delete guards still block profiles that remain actively bound.');
    expect(scratchpad).toContain('Shared wrappers do not import EE files via raw filesystem-relative paths.');
  });
});
