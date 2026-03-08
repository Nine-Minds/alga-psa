import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../..');

function repoPath(relativePath: string): string {
  return path.join(repoRoot, relativePath);
}

describe('teams runtime EE ownership', () => {
  it('T167/T169/T171/T173/T185/T187: keeps concrete Teams runtime helpers under ee/server ownership', () => {
    expect(fs.existsSync(repoPath('server/src/lib/teams/bot/teamsBotHandler.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/messageExtension/teamsMessageExtensionHandler.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/quickActions/teamsQuickActionHandler.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/actions/teamsActionRegistry.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/resolveTeamsTenantContext.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/handleTeamsAuthCallback.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/resolveTeamsTabAuthState.ts'))).toBe(false);

    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/bot/teamsBotHandler.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/messageExtension/teamsMessageExtensionHandler.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/quickActions/teamsQuickActionHandler.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/actions/teamsActionRegistry.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/resolveTeamsTenantContext.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/handleTeamsAuthCallback.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/resolveTeamsTabAuthState.ts'))).toBe(true);
  });

  it('T175/T177/T179/T221: keeps Teams package and action-registry implementations under EE while leaving a shared wrapper entrypoint', () => {
    const sharedPackageActionsPath = repoPath('packages/integrations/src/actions/integrations/teamsPackageActions.ts');
    const sharedPackageActionsSource = fs.readFileSync(sharedPackageActionsPath, 'utf8');

    expect(fs.existsSync(sharedPackageActionsPath)).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/actions/integrations/teamsPackageActions.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('server/src/lib/teams/actions/teamsActionRegistry.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/actions/teamsActionRegistry.ts'))).toBe(true);

    expect(sharedPackageActionsSource).toContain('getTeamsAvailability');
    expect(sharedPackageActionsSource).toContain('loadEeTeamsPackageActions');
    expect(sharedPackageActionsSource).toContain('getTeamsAppPackageStatusImpl');
    expect(sharedPackageActionsSource).not.toContain('function buildTeamsAppManifest');
  });

  it('T191/T192/T223/T227/T239/T261: keeps Teams settings persistence under EE while leaving shared action wrappers in place', () => {
    const sharedTeamsActionsPath = repoPath('packages/integrations/src/actions/integrations/teamsActions.ts');
    const sharedTeamsActionsSource = fs.readFileSync(sharedTeamsActionsPath, 'utf8');

    expect(fs.existsSync(sharedTeamsActionsPath)).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/actions/integrations/teamsActions.ts'))).toBe(true);
    expect(sharedTeamsActionsSource).toContain('loadEeTeamsActions');
    expect(sharedTeamsActionsSource).toContain('getTeamsIntegrationStatusImpl');
    expect(sharedTeamsActionsSource).toContain('getTeamsIntegrationExecutionStateImpl');
    expect(sharedTeamsActionsSource).toContain('saveTeamsIntegrationSettingsImpl');
    expect(sharedTeamsActionsSource).not.toContain('function mapTeamsIntegrationRow');
  });

  it('T181/T283: keeps Teams notification delivery implementation under EE while leaving the shared broadcaster wrapper in place', () => {
    const sharedTeamsNotificationPath = repoPath('packages/notifications/src/realtime/teamsNotificationDelivery.ts');
    const sharedTeamsNotificationSource = fs.readFileSync(sharedTeamsNotificationPath, 'utf8');

    expect(fs.existsSync(sharedTeamsNotificationPath)).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/notifications/teamsNotificationDelivery.ts'))).toBe(true);
    expect(sharedTeamsNotificationSource).toContain('loadEeTeamsNotificationDelivery');
    expect(sharedTeamsNotificationSource).toContain('getTeamsAvailability');
    expect(sharedTeamsNotificationSource).toContain('deliverTeamsNotificationImpl');
    expect(sharedTeamsNotificationSource).not.toContain('teamwork/sendActivityNotification');
  });

  it('T183/T295: keeps Teams deep-link composition under ee/server ownership', () => {
    expect(fs.existsSync(repoPath('packages/integrations/src/actions/integrations/teamsPackageShared.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/teamsDeepLinks.ts'))).toBe(true);
  });

  it('T253/T254/T255/T256/T261/T262: keeps the shared Teams settings actions availability-gated while the concrete persistence logic stays in EE', () => {
    const sharedTeamsActionsPath = repoPath('packages/integrations/src/actions/integrations/teamsActions.ts');
    const sharedTeamsActionsSource = fs.readFileSync(sharedTeamsActionsPath, 'utf8');

    expect(fs.existsSync(sharedTeamsActionsPath)).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/actions/integrations/teamsActions.ts'))).toBe(true);
    expect(sharedTeamsActionsSource).toContain('getTeamsAvailability');
    expect(sharedTeamsActionsSource).toContain('loadEeTeamsActions');
    expect(sharedTeamsActionsSource).toContain('getTeamsIntegrationStatusImpl');
    expect(sharedTeamsActionsSource).toContain('saveTeamsIntegrationSettingsImpl');
    expect(sharedTeamsActionsSource).not.toContain('function validateSelectedProfile');
  });
});
