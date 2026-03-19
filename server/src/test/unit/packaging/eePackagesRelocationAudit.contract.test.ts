import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(process.cwd(), '..');

function repoPath(relativePath: string): string {
  return path.join(repoRoot, relativePath);
}

function readSource(relativePath: string): string {
  return fs.readFileSync(repoPath(relativePath), 'utf8');
}

function listSourceFiles(relativeDir: string): string[] {
  const root = repoPath(relativeDir);
  const files: string[] = [];

  const walk = (currentDir: string) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const nextPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(nextPath);
        continue;
      }

      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
        continue;
      }

      files.push(path.relative(repoRoot, nextPath));
    }
  };

  walk(root);
  return files.sort();
}

describe('EE package relocation audits', () => {
  it('routes shared calendar and Teams callers through first-class EE package entrypoints', () => {
    const sharedCalendarActions = readSource('packages/integrations/src/actions/calendarActions.ts');
    const sharedCalendarSettings = readSource(
      'packages/integrations/src/components/settings/integrations/CalendarEnterpriseIntegrationSettings.tsx'
    );
    const sharedIntegrationsComponents = readSource('packages/integrations/src/components/index.ts');
    const sharedCalendarProfile = readSource('server/src/components/settings/profile/UserProfile.tsx');
    const enterpriseCalendarSettings = readSource(
      'ee/packages/calendar/src/components/settings/integrations/CalendarIntegrationsSettings.tsx'
    );
    const enterpriseCalendarProfile = readSource(
      'ee/packages/calendar/src/components/settings/profile/CalendarProfileSettings.tsx'
    );
    const sharedTeamsActions = readSource('packages/integrations/src/actions/integrations/teamsActions.ts');
    const sharedTeamsPackageActions = readSource(
      'packages/integrations/src/actions/integrations/teamsPackageActions.ts'
    );
    const sharedTeamsSettings = readSource(
      'packages/integrations/src/components/settings/integrations/TeamsEnterpriseIntegrationSettings.tsx'
    );
    const sharedTeamsNotifications = readSource('packages/notifications/src/realtime/teamsNotificationDelivery.ts');
    const sharedTeamsAuth = readSource('packages/auth/src/lib/sso/teamsMicrosoftProviderResolution.ts');

    expect(sharedCalendarActions).toContain("import('@alga-psa/ee-calendar/actions')");
    expect(sharedCalendarActions).not.toContain('@enterprise/');
    expect(sharedCalendarSettings).toContain("import('@alga-psa/ee-calendar/components')");
    expect(sharedCalendarSettings).toContain('CalendarIntegrationsSettings');
    expect(sharedIntegrationsComponents).not.toContain("export * from './calendar';");
    expect(sharedCalendarProfile).toContain(
      "import('@alga-psa/ee-calendar/components').then((mod) => mod.CalendarProfileSettings)"
    );
    expect(sharedCalendarProfile).not.toContain('packages/ee/src/components/settings/profile/CalendarProfileSettings');
    expect(enterpriseCalendarSettings).toContain("../../calendar/CalendarIntegrationsSettings");
    expect(enterpriseCalendarSettings).not.toContain("@alga-psa/integrations/components");
    expect(enterpriseCalendarProfile).toContain("../../calendar/CalendarIntegrationsSettings");
    expect(enterpriseCalendarProfile).not.toContain("@alga-psa/integrations/components");

    expect(sharedTeamsActions).toContain("import('@alga-psa/ee-microsoft-teams/actions')");
    expect(sharedTeamsActions).not.toContain('ee/server/src/lib/actions/integrations/teamsActions');
    expect(sharedTeamsPackageActions).toContain("import('@alga-psa/ee-microsoft-teams/actions')");
    expect(sharedTeamsPackageActions).not.toContain('ee/server/src/lib/actions/integrations/teamsPackageActions');
    expect(sharedTeamsSettings).toContain(
      "import('@alga-psa/ee-microsoft-teams/components').then((mod) => mod.TeamsIntegrationSettings)"
    );
    expect(sharedTeamsNotifications).toContain(
      "import('@alga-psa/ee-microsoft-teams/lib/notifications/teamsNotificationDelivery')"
    );
    expect(sharedTeamsNotifications).not.toContain('ee/server/src/lib/notifications/teamsNotificationDelivery');
    expect(sharedTeamsAuth).toContain(
      "import('@alga-psa/ee-microsoft-teams/lib/auth/teamsMicrosoftProviderResolution')"
    );
    expect(sharedTeamsAuth).not.toContain('ee/server/src/lib/auth/teamsMicrosoftProviderResolution');
  });

  it('keeps shared calendar helper wrappers pointed at the new calendar package instead of legacy enterprise stubs', () => {
    const sharedSubscriber = readSource('server/src/lib/eventBus/subscribers/calendarSyncSubscriber.ts');
    const sharedMaintenance = readSource('server/src/lib/jobs/handlers/calendarWebhookMaintenanceHandler.ts');

    expect(sharedSubscriber).toContain("import('@alga-psa/ee-calendar/event-bus')");
    expect(sharedSubscriber).not.toContain("@enterprise/lib/eventBus/subscribers/calendarSyncSubscriber");
    expect(sharedSubscriber).not.toContain('CalendarSyncService');
    expect(sharedMaintenance).toContain("import('@alga-psa/ee-calendar/jobs')");
    expect(sharedMaintenance).not.toContain('@enterprise/lib/jobs/handlers/calendarWebhookMaintenanceHandler');
    expect(sharedMaintenance).not.toContain('CalendarWebhookMaintenanceService');
  });

  it('keeps packages/ee calendar files as forwarders and Teams files as CE stubs only', () => {
    const calendarRouteForwarder = readSource('packages/ee/src/app/api/auth/google/calendar/callback/route.ts');
    const calendarUiForwarder = readSource('packages/ee/src/components/settings/profile/CalendarProfileSettings.tsx');
    const calendarActionsForwarder = readSource('packages/ee/src/lib/actions/integrations/calendarActions.ts');
    const teamsRouteStub = readSource('packages/ee/src/app/api/teams/bot/messages/route.ts');
    const teamsUiStub = readSource('packages/ee/src/components/settings/integrations/TeamsIntegrationSettings.tsx');
    const teamsActionsStub = readSource('packages/ee/src/lib/actions/integrations/teamsActions.ts');

    expect(calendarRouteForwarder).toContain('@alga-psa/ee-calendar/routes');
    expect(calendarRouteForwarder).not.toContain('CalendarProviderService');
    expect(calendarUiForwarder).toContain('@alga-psa/ee-calendar/components');
    expect(calendarUiForwarder).not.toContain('useState');
    expect(calendarActionsForwarder).toContain('@alga-psa/ee-calendar/actions');
    expect(calendarActionsForwarder).not.toContain('CalendarSyncService');

    expect(teamsRouteStub).toContain('eeUnavailable');
    expect(teamsRouteStub).not.toContain('@alga-psa/ee-microsoft-teams');
    expect(teamsUiStub).toContain('return null;');
    expect(teamsUiStub).not.toContain('@alga-psa/ee-microsoft-teams');
    expect(teamsActionsStub).toContain('Microsoft Teams integration is only available in Enterprise Edition.');
    expect(teamsActionsStub).not.toContain('@alga-psa/ee-microsoft-teams');
  });

  it('keeps TypeScript, Vitest, and Next.js aliasing on the new EE package names while preserving CE fail-closed enterprise aliases', () => {
    const baseTsconfig = readSource('tsconfig.base.json');
    const serverTsconfig = readSource('server/tsconfig.json');
    const vitestConfig = readSource('server/vitest.config.ts');
    const nextConfig = readSource('server/next.config.mjs');

    expect(baseTsconfig).toContain('"@alga-psa/ee-calendar"');
    expect(baseTsconfig).toContain('"@alga-psa/ee-microsoft-teams"');
    expect(serverTsconfig).toContain('"@alga-psa/ee-calendar"');
    expect(serverTsconfig).toContain('"@alga-psa/ee-microsoft-teams"');
    expect(vitestConfig).toContain('@alga-psa\\/ee-calendar');
    expect(vitestConfig).toContain('@alga-psa\\/ee-microsoft-teams');
    expect(nextConfig).toContain("'@alga-psa/ee-calendar': '../ee/packages/calendar/src/index.ts'");
    expect(nextConfig).toContain("'@alga-psa/ee-microsoft-teams': '../ee/packages/microsoft-teams/src/index.ts'");
    expect(nextConfig).toContain("'@enterprise': isEE ? '../ee/server/src' : '../packages/ee/src'");
    expect(nextConfig).toContain("'@ee': isEE ? '../ee/server/src' : '../packages/ee/src'");
  });

  it('keeps the new EE packages free of ee/server and legacy enterprise alias imports to avoid new ownership cycles', () => {
    const packageSources = [
      ...listSourceFiles('ee/packages/calendar/src'),
      ...listSourceFiles('ee/packages/microsoft-teams/src'),
    ];

    for (const sourcePath of packageSources) {
      const source = readSource(sourcePath);
      expect(source, sourcePath).not.toContain('ee/server/src');
      expect(source, sourcePath).not.toContain('@enterprise/');
      expect(source, sourcePath).not.toContain('@ee/');
    }
  });

  it('removes old live-root references from active source ownership notes and import audits', () => {
    const auditedRoots = [
      'packages/auth/src',
      'packages/integrations/src',
      'packages/notifications/src',
      'ee/server/src',
      'ee/packages/calendar/src',
      'ee/packages/microsoft-teams/src',
      'server/src/lib/eventBus',
      'server/src/lib/jobs',
      'server/src/components/settings/profile',
    ];
    const disallowedSnippets = [
      'packages/ee/src/lib/actions/integrations/calendarActions.ts',
      'packages/ee/src/lib/services/calendar/',
      'packages/ee/src/lib/eventBus/subscribers/calendarSyncSubscriber.ts',
      'packages/ee/src/lib/jobs/handlers/calendarWebhookMaintenanceHandler.ts',
      'ee/server/src/lib/actions/integrations/teamsActions.ts',
      'ee/server/src/lib/actions/integrations/teamsPackageActions.ts',
      'ee/server/src/lib/notifications/teamsNotificationDelivery.ts',
      'ee/server/src/lib/auth/teamsMicrosoftProviderResolution.ts',
    ];

    for (const root of auditedRoots) {
      for (const sourcePath of listSourceFiles(root)) {
        const source = readSource(sourcePath);
        for (const disallowedSnippet of disallowedSnippets) {
          expect(source, `${sourcePath} should not reference ${disallowedSnippet}`).not.toContain(
            disallowedSnippet
          );
        }
      }
    }
  });

  it('keeps unrelated enterprise domains under packages/ee instead of broadening this relocation', () => {
    expect(fs.existsSync(repoPath('packages/ee/src/lib/sla/TemporalSlaBackend.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/packages/sla'))).toBe(false);
    expect(fs.existsSync(repoPath('ee/packages/licensing'))).toBe(false);
  });
});
