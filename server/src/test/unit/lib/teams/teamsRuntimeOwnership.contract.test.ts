import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../..');

function repoPath(relativePath: string): string {
  return path.join(repoRoot, relativePath);
}

describe('teams runtime EE ownership', () => {
  it('T167/T169/T171/T173/T185/T187/T197/T199/T200/T201/T202/T357: keeps concrete Teams runtime helpers under ee/server ownership with explicit EE naming and entrypoints', () => {
    expect(fs.existsSync(repoPath('server/src/lib/teams/bot/teamsBotHandler.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/messageExtension/teamsMessageExtensionHandler.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/quickActions/teamsQuickActionHandler.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/actions/teamsActionRegistry.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/buildTeamsFullPsaUrl.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/resolveTeamsLinkedUser.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/resolveTeamsTabAccessState.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/resolveTeamsTabDestination.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/resolveTeamsTenantContext.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/handleTeamsAuthCallback.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/resolveTeamsTabAuthState.ts'))).toBe(false);

    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/bot/teamsBotHandler.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/messageExtension/teamsMessageExtensionHandler.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/quickActions/teamsQuickActionHandler.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/actions/teamsActionRegistry.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/buildTeamsFullPsaUrl.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/resolveTeamsLinkedUser.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/resolveTeamsTabAccessState.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/resolveTeamsTabDestination.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/resolveTeamsTenantContext.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/handleTeamsAuthCallback.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/resolveTeamsTabAuthState.ts'))).toBe(true);
  });

  it('T193/T194/T203/T204: keeps Microsoft profile management shared instead of duplicating it under EE Teams ownership', () => {
    expect(fs.existsSync(repoPath('packages/integrations/src/components/settings/integrations/MicrosoftIntegrationSettings.tsx'))).toBe(
      true
    );
    expect(fs.existsSync(repoPath('packages/integrations/src/actions/integrations/microsoftActions.ts'))).toBe(true);

    expect(fs.existsSync(repoPath('ee/server/src/components/settings/integrations/MicrosoftIntegrationSettings.tsx'))).toBe(
      false
    );
    expect(fs.existsSync(repoPath('ee/server/src/lib/actions/integrations/microsoftActions.ts'))).toBe(false);
  });

  it('T205/T206: keeps Teams on one tenant integration model backed by the selected shared Microsoft profile instead of introducing a second EE-only credential model', () => {
    const eeTeamsActionsSource = fs.readFileSync(
      repoPath('ee/server/src/lib/actions/integrations/teamsActions.ts'),
      'utf8'
    );
    const eeTeamsPackageActionsSource = fs.readFileSync(
      repoPath('ee/server/src/lib/actions/integrations/teamsPackageActions.ts'),
      'utf8'
    );
    const eeTeamsNotificationSource = fs.readFileSync(
      repoPath('ee/server/src/lib/notifications/teamsNotificationDelivery.ts'),
      'utf8'
    );
    const eeTeamsTenantContextSource = fs.readFileSync(
      repoPath('ee/server/src/lib/teams/resolveTeamsTenantContext.ts'),
      'utf8'
    );

    expect(eeTeamsActionsSource).toContain("knex('teams_integrations')");
    expect(eeTeamsPackageActionsSource).toContain('selected_profile_id');
    expect(eeTeamsNotificationSource).toContain("knex('microsoft_profiles')");
    expect(eeTeamsTenantContextSource).toContain("teams.selected_profile_id");
    expect(eeTeamsTenantContextSource).toContain("profiles.profile_id");
    expect(fs.existsSync(repoPath('ee/server/src/lib/actions/integrations/teamsMicrosoftActions.ts'))).toBe(false);
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

  it('T263/T273/T275: keeps Teams-specific auth helpers under EE while shared auth exports only fail-closed wrappers', () => {
    const sharedTeamsMicrosoftProviderResolutionPath = repoPath('packages/auth/src/lib/sso/teamsMicrosoftProviderResolution.ts');
    const sharedTeamsMicrosoftProviderResolutionSource = fs.readFileSync(sharedTeamsMicrosoftProviderResolutionPath, 'utf8');

    expect(fs.existsSync(sharedTeamsMicrosoftProviderResolutionPath)).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/auth/teamsMicrosoftProviderResolution.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('server/src/lib/teams/buildTeamsReauthUrl.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/buildTeamsReauthUrl.ts'))).toBe(true);
    expect(sharedTeamsMicrosoftProviderResolutionSource).toContain('loadEeTeamsMicrosoftProviderResolution');
    expect(sharedTeamsMicrosoftProviderResolutionSource).toContain('resolveTeamsMicrosoftProviderConfigImpl');
    expect(sharedTeamsMicrosoftProviderResolutionSource).not.toContain('getAdminConnection');
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
