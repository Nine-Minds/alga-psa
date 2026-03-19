import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../..');

function repoPath(relativePath: string): string {
  return path.join(repoRoot, relativePath);
}

describe('teams runtime EE ownership', () => {
  it('T165/T166/T167/T169/T171/T173/T185/T187/T197/T199/T200/T201/T202/T357/T359/T360: keeps concrete Teams runtime helpers under ee/server ownership with explicit EE naming and entrypoints', () => {
    const sharedTeamsTabPageSource = fs.readFileSync(repoPath('server/src/app/teams/tab/page.tsx'), 'utf8');

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
    expect(fs.existsSync(repoPath('ee/server/src/app/teams/tab/page.tsx'))).toBe(true);
    expect(sharedTeamsTabPageSource).toContain("import('@enterprise/app/teams/tab/page')");
    expect(sharedTeamsTabPageSource).not.toContain('resolveTeamsTabAuthState');
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
      repoPath('ee/packages/microsoft-teams/src/lib/actions/integrations/teamsActions.ts'),
      'utf8'
    );
    const eeTeamsPackageActionsSource = fs.readFileSync(
      repoPath('ee/packages/microsoft-teams/src/lib/actions/integrations/teamsPackageActions.ts'),
      'utf8'
    );
    const eeTeamsNotificationSource = fs.readFileSync(
      repoPath('ee/packages/microsoft-teams/src/lib/notifications/teamsNotificationDelivery.ts'),
      'utf8'
    );
    const eeTeamsTenantContextSource = fs.readFileSync(
      repoPath('ee/packages/microsoft-teams/src/lib/teams/resolveTeamsTenantContext.ts'),
      'utf8'
    );
    const eeTeamsActionsWrapperSource = fs.readFileSync(
      repoPath('ee/server/src/lib/actions/integrations/teamsActions.ts'),
      'utf8'
    );

    expect(eeTeamsActionsSource).toContain("knex('teams_integrations')");
    expect(eeTeamsPackageActionsSource).toContain('selected_profile_id');
    expect(eeTeamsNotificationSource).toContain("knex('microsoft_profiles')");
    expect(eeTeamsTenantContextSource).toContain("teams.selected_profile_id");
    expect(eeTeamsTenantContextSource).toContain("profiles.profile_id");
    expect(eeTeamsActionsWrapperSource).toContain("@alga-psa/ee-microsoft-teams/actions");
    expect(eeTeamsActionsWrapperSource).not.toContain("knex('teams_integrations')");
    expect(fs.existsSync(repoPath('ee/server/src/lib/actions/integrations/teamsMicrosoftActions.ts'))).toBe(false);
  });

  it('T175/T176/T177/T178/T179/T180/T221/T239/T240/T241/T242/T243/T244/T257/T258/T259/T260/T367/T368/T369/T370/T371/T372/T435: keeps Teams package/action contracts in shared wrapper modules while concrete implementations stay in EE', () => {
    const sharedPackageActionsPath = repoPath('packages/integrations/src/actions/integrations/teamsPackageActions.ts');
    const sharedPackageActionsSource = fs.readFileSync(sharedPackageActionsPath, 'utf8');
    const sharedTeamsActionsPath = repoPath('packages/integrations/src/actions/integrations/teamsActions.ts');
    const sharedTeamsActionsSource = fs.readFileSync(sharedTeamsActionsPath, 'utf8');
    const sharedTeamsConstantsSource = fs.readFileSync(
      repoPath('packages/integrations/src/actions/integrations/teamsShared.ts'),
      'utf8'
    );
    const sharedTeamsContractsSource = fs.readFileSync(
      repoPath('packages/integrations/src/actions/integrations/teamsContracts.ts'),
      'utf8'
    );
    const integrationsActionIndexSource = fs.readFileSync(
      repoPath('packages/integrations/src/actions/integrations/index.ts'),
      'utf8'
    );
    const rootActionIndexSource = fs.readFileSync(
      repoPath('packages/integrations/src/actions/index.ts'),
      'utf8'
    );
    const eeTeamsActionsSource = fs.readFileSync(
      repoPath('ee/packages/microsoft-teams/src/lib/actions/integrations/teamsActions.ts'),
      'utf8'
    );
    const eeTeamsPackageActionsSource = fs.readFileSync(
      repoPath('ee/packages/microsoft-teams/src/lib/actions/integrations/teamsPackageActions.ts'),
      'utf8'
    );
    const eeTeamsActionsWrapperSource = fs.readFileSync(
      repoPath('ee/server/src/lib/actions/integrations/teamsActions.ts'),
      'utf8'
    );
    const eeTeamsPackageActionsWrapperSource = fs.readFileSync(
      repoPath('ee/server/src/lib/actions/integrations/teamsPackageActions.ts'),
      'utf8'
    );

    expect(fs.existsSync(sharedPackageActionsPath)).toBe(true);
    expect(fs.existsSync(sharedTeamsActionsPath)).toBe(true);
    expect(fs.existsSync(repoPath('packages/integrations/src/actions/integrations/teamsContracts.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/actions/integrations/teamsPackageActions.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('server/src/lib/teams/actions/teamsActionRegistry.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/actions/teamsActionRegistry.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/actions/integrations/microsoftConsumerBindings.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('packages/integrations/src/components/settings/integrations/TeamsIntegrationSettings.tsx'))).toBe(
      false
    );
    expect(fs.existsSync(repoPath('server/src/lib/notifications/teamsNotificationDelivery.ts'))).toBe(false);

    expect(sharedTeamsConstantsSource).not.toMatch(/['"]use server['"]/);
    expect(sharedTeamsConstantsSource).toContain('export const TEAMS_INSTALL_STATUSES');
    expect(sharedTeamsConstantsSource).toContain('export const TEAMS_CAPABILITIES');
    expect(sharedTeamsConstantsSource).toContain('export const TEAMS_NOTIFICATION_CATEGORIES');
    expect(sharedTeamsConstantsSource).toContain('export const TEAMS_ALLOWED_ACTIONS');
    expect(sharedTeamsContractsSource).not.toMatch(/['"]use server['"]/);
    expect(sharedTeamsContractsSource).toContain('export interface TeamsIntegrationStatusResponse');
    expect(sharedTeamsContractsSource).toContain('export interface TeamsAppPackageStatusResponse');

    expect(sharedTeamsActionsSource.startsWith("'use server';")).toBe(true);
    expect(sharedPackageActionsSource.startsWith("'use server';")).toBe(true);
    expect(sharedTeamsActionsSource).toContain("from './teamsContracts'");
    expect(sharedTeamsActionsSource).toContain("from './teamsShared'");
    expect(sharedPackageActionsSource).toContain("from './teamsContracts'");
    expect(sharedTeamsActionsSource).toContain("import('@alga-psa/ee-microsoft-teams/actions')");
    expect(sharedPackageActionsSource).toContain("import('@alga-psa/ee-microsoft-teams/actions')");
    expect(sharedTeamsActionsSource).not.toContain('ee/server/src/lib/actions/integrations/teamsActions');
    expect(sharedPackageActionsSource).not.toContain('ee/server/src/lib/actions/integrations/teamsPackageActions');

    expect(eeTeamsActionsSource).toContain("@alga-psa/integrations/actions/integrations/teamsContracts");
    expect(eeTeamsActionsSource).toContain("@alga-psa/integrations/actions/integrations/teamsShared");
    expect(eeTeamsActionsSource).not.toContain("@alga-psa/integrations/actions/integrations/teamsActions';");
    expect(eeTeamsPackageActionsSource).toContain("@alga-psa/integrations/actions/integrations/teamsContracts");
    expect(eeTeamsPackageActionsSource).not.toContain("@alga-psa/integrations/actions/integrations/teamsPackageActions';");
    expect(eeTeamsActionsWrapperSource).toContain("@alga-psa/ee-microsoft-teams/actions");
    expect(eeTeamsPackageActionsWrapperSource).toContain("@alga-psa/ee-microsoft-teams/actions");

    expect(integrationsActionIndexSource).toContain("from './teamsActions';");
    expect(integrationsActionIndexSource).toContain("from './teamsPackageActions';");
    expect(integrationsActionIndexSource).toContain('getTeamsIntegrationStatus');
    expect(integrationsActionIndexSource).toContain('saveTeamsIntegrationSettings');
    expect(integrationsActionIndexSource).toContain('getTeamsAppPackageStatus');
    expect(integrationsActionIndexSource).not.toContain('@enterprise/');
    expect(integrationsActionIndexSource).not.toContain("from './TeamsIntegrationSettings'");
    expect(rootActionIndexSource).toContain("from './integrations/teamsActions';");
    expect(rootActionIndexSource).toContain("from './integrations/teamsPackageActions';");
    expect(rootActionIndexSource).not.toContain('@enterprise/');
    expect(rootActionIndexSource).not.toContain("from './TeamsIntegrationSettings'");

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

  it('T181/T182/T283/T292/T293/T294/T305/T306/T353/T354: keeps Teams notification delivery implementation under EE while shared notification code imports only wrappers', () => {
    const sharedTeamsNotificationPath = repoPath('packages/notifications/src/realtime/teamsNotificationDelivery.ts');
    const sharedTeamsNotificationSource = fs.readFileSync(sharedTeamsNotificationPath, 'utf8');
    const sharedNotificationBroadcasterSource = fs.readFileSync(
      repoPath('packages/notifications/src/realtime/internalNotificationBroadcaster.ts'),
      'utf8'
    );

    expect(fs.existsSync(sharedTeamsNotificationPath)).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/notifications/teamsNotificationDelivery.ts'))).toBe(true);
    expect(sharedTeamsNotificationSource).toContain('loadEeTeamsNotificationDelivery');
    expect(sharedTeamsNotificationSource).toContain('getTeamsAvailability');
    expect(sharedTeamsNotificationSource).toContain('deliverTeamsNotificationImpl');
    expect(sharedTeamsNotificationSource).toContain("import('@alga-psa/ee-microsoft-teams/lib/notifications/teamsNotificationDelivery')");
    expect(sharedTeamsNotificationSource).not.toContain('teamwork/sendActivityNotification');
    expect(sharedNotificationBroadcasterSource).toContain("import { deliverTeamsNotification } from './teamsNotificationDelivery';");
    expect(sharedNotificationBroadcasterSource).not.toContain('ee/server/src/lib/notifications/teamsNotificationDelivery');
  });

  it('T183/T184/T295/T296: keeps Teams deep-link composition under ee/server ownership', () => {
    expect(fs.existsSync(repoPath('packages/integrations/src/actions/integrations/teamsPackageShared.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/teamsDeepLinks.ts'))).toBe(true);
  });

  it('T247/T248/T263/T273/T275/T355/T356: keeps Teams-specific auth helpers under EE while shared auth exports only fail-closed wrappers', () => {
    const sharedTeamsMicrosoftProviderResolutionPath = repoPath('packages/auth/src/lib/sso/teamsMicrosoftProviderResolution.ts');
    const sharedTeamsMicrosoftProviderResolutionSource = fs.readFileSync(sharedTeamsMicrosoftProviderResolutionPath, 'utf8');
    const sharedAuthIndexSource = fs.readFileSync(repoPath('packages/auth/src/lib/sso/index.ts'), 'utf8');

    expect(fs.existsSync(sharedTeamsMicrosoftProviderResolutionPath)).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/auth/teamsMicrosoftProviderResolution.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('server/src/lib/teams/buildTeamsReauthUrl.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/buildTeamsReauthUrl.ts'))).toBe(true);
    expect(sharedTeamsMicrosoftProviderResolutionSource).toContain('loadEeTeamsMicrosoftProviderResolution');
    expect(sharedTeamsMicrosoftProviderResolutionSource).toContain('resolveTeamsMicrosoftProviderConfigImpl');
    expect(sharedTeamsMicrosoftProviderResolutionSource).toContain("import('@alga-psa/ee-microsoft-teams/lib/auth/teamsMicrosoftProviderResolution')");
    expect(sharedTeamsMicrosoftProviderResolutionSource).not.toContain('getAdminConnection');
    expect(sharedAuthIndexSource).toContain("export * from './teamsMicrosoftProviderResolution';");
    expect(sharedAuthIndexSource).not.toContain('ee/server/src/lib/auth/teamsMicrosoftProviderResolution');
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
