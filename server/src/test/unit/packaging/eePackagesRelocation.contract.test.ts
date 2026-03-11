import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(process.cwd(), '..');

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')) as T;
}

describe('EE package relocation scaffolding', () => {
  it('exposes valid calendar package metadata and workspace targets', () => {
    const pkg = readJson<{
      name: string;
      scripts: Record<string, string>;
      exports: Record<string, unknown>;
      dependencies: Record<string, string>;
      peerDependencies: Record<string, string>;
    }>('ee/packages/calendar/package.json');
    const project = readJson<{
      name: string;
      sourceRoot: string;
      targets: Record<string, unknown>;
    }>('ee/packages/calendar/project.json');
    const tsconfig = readJson<{ include: string[] }>('ee/packages/calendar/tsconfig.json');

    expect(pkg.name).toBe('@alga-psa/ee-calendar');
    expect(pkg.scripts.build).toBe('tsup');
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.exports).toHaveProperty('.');
    expect(pkg.exports).toHaveProperty('./actions');
    expect(pkg.exports).toHaveProperty('./components');
    expect(pkg.exports).toHaveProperty('./routes');
    expect(pkg.exports).toHaveProperty('./lib');
    expect(pkg.dependencies).toMatchObject({
      '@alga-psa/core': '*',
      '@alga-psa/db': '*',
      '@alga-psa/integrations': '*',
      '@alga-psa/types': '*',
    });
    expect(pkg.peerDependencies).toMatchObject({
      react: expect.any(String),
      'react-dom': expect.any(String),
    });

    expect(project.name).toBe('@alga-psa/ee-calendar');
    expect(project.sourceRoot).toBe('ee/packages/calendar/src');
    expect(project.targets).toHaveProperty('build');
    expect(project.targets).toHaveProperty('test');
    expect(project.targets).toHaveProperty('lint');
    expect(tsconfig.include).toContain('src/**/*');
  });

  it('exposes valid microsoft teams package metadata and workspace targets', () => {
    const pkg = readJson<{
      name: string;
      scripts: Record<string, string>;
      exports: Record<string, unknown>;
      dependencies: Record<string, string>;
      peerDependencies: Record<string, string>;
    }>('ee/packages/microsoft-teams/package.json');
    const project = readJson<{
      name: string;
      sourceRoot: string;
      targets: Record<string, unknown>;
    }>('ee/packages/microsoft-teams/project.json');
    const tsconfig = readJson<{ include: string[] }>('ee/packages/microsoft-teams/tsconfig.json');

    expect(pkg.name).toBe('@alga-psa/ee-microsoft-teams');
    expect(pkg.scripts.build).toBe('tsup');
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.exports).toHaveProperty('.');
    expect(pkg.exports).toHaveProperty('./actions');
    expect(pkg.exports).toHaveProperty('./components');
    expect(pkg.exports).toHaveProperty('./routes');
    expect(pkg.exports).toHaveProperty('./lib');
    expect(pkg.dependencies).toMatchObject({
      '@alga-psa/auth': '*',
      '@alga-psa/core': '*',
      '@alga-psa/integrations': '*',
      '@alga-psa/notifications': '*',
    });
    expect(pkg.peerDependencies).toMatchObject({
      react: expect.any(String),
      'react-dom': expect.any(String),
    });

    expect(project.name).toBe('@alga-psa/ee-microsoft-teams');
    expect(project.sourceRoot).toBe('ee/packages/microsoft-teams/src');
    expect(project.targets).toHaveProperty('build');
    expect(project.targets).toHaveProperty('test');
    expect(project.targets).toHaveProperty('lint');
    expect(tsconfig.include).toContain('src/**/*');
  });

  it('uses non-colliding package names and resolves the new public entrypoints', async () => {
    const teamsPkg = readJson<{ name: string }>('packages/teams/package.json');
    const calendarPkg = readJson<{ name: string }>('ee/packages/calendar/package.json');
    const microsoftTeamsPkg = readJson<{ name: string }>('ee/packages/microsoft-teams/package.json');
    const calendarIndexSource = fs.readFileSync(
      path.join(repoRoot, 'ee/packages/calendar/src/index.ts'),
      'utf8'
    );
    const calendarActionsSource = fs.readFileSync(
      path.join(repoRoot, 'ee/packages/calendar/src/actions/index.ts'),
      'utf8'
    );
    const calendarComponentsSource = fs.readFileSync(
      path.join(repoRoot, 'ee/packages/calendar/src/components/index.ts'),
      'utf8'
    );
    const calendarRoutesSource = fs.readFileSync(
      path.join(repoRoot, 'ee/packages/calendar/src/routes/index.ts'),
      'utf8'
    );
    const calendarLibSource = fs.readFileSync(
      path.join(repoRoot, 'ee/packages/calendar/src/lib/index.ts'),
      'utf8'
    );
    const teamsIndexSource = fs.readFileSync(
      path.join(repoRoot, 'ee/packages/microsoft-teams/src/index.ts'),
      'utf8'
    );
    const teamsActionsSource = fs.readFileSync(
      path.join(repoRoot, 'ee/packages/microsoft-teams/src/actions/index.ts'),
      'utf8'
    );
    const teamsComponentsSource = fs.readFileSync(
      path.join(repoRoot, 'ee/packages/microsoft-teams/src/components/index.ts'),
      'utf8'
    );
    const teamsRoutesSource = fs.readFileSync(
      path.join(repoRoot, 'ee/packages/microsoft-teams/src/routes/index.ts'),
      'utf8'
    );
    const teamsLibSource = fs.readFileSync(
      path.join(repoRoot, 'ee/packages/microsoft-teams/src/lib/index.ts'),
      'utf8'
    );

    expect(calendarPkg.name).not.toBe(teamsPkg.name);
    expect(microsoftTeamsPkg.name).not.toBe(teamsPkg.name);
    expect(calendarPkg.name).not.toBe(microsoftTeamsPkg.name);

    expect(calendarIndexSource).toContain("export * from './actions';");
    expect(calendarIndexSource).toContain("export * from './components';");
    expect(calendarIndexSource).toContain("export * from './routes';");
    expect(calendarActionsSource).toContain('calendarActions');
    expect(calendarComponentsSource).toContain('CalendarIntegrationsSettings');
    expect(calendarComponentsSource).toContain('CalendarProfileSettings');
    expect(calendarRoutesSource).toContain('handleGoogleCalendarOAuthCallbackGet');
    expect(calendarLibSource).toContain('CalendarWebhookProcessor');

    expect(teamsIndexSource).toContain("export * from './actions';");
    expect(teamsIndexSource).toContain("export * from './components';");
    expect(teamsIndexSource).toContain("export * from './routes';");
    expect(teamsActionsSource).toContain('teamsActions');
    expect(teamsActionsSource).toContain('teamsPackageActions');
    expect(teamsComponentsSource).toContain('TeamsIntegrationSettings');
    expect(teamsRoutesSource).toContain('handleTeamsBotMessagesPost');
    expect(teamsRoutesSource).toContain('TeamsTabPage');
    expect(teamsLibSource).toContain("export * from './notifications/teamsNotificationDelivery';");
  });
});
