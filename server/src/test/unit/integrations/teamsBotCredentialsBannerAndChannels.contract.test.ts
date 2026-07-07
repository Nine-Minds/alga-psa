import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readLocale(locale: string): string {
  return readRepoFile(`server/public/locales/${locale}/msp/integrations.json`);
}

const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'xx', 'yy'];

describe('Teams bot credentials banner and notification channel contracts', () => {
  it('T081: shows the missing bot-connector-credentials banner only while active and unconfigured, wired to diagnostics guidance', () => {
    const uiSource = readRepoFile('packages/integrations/src/components/settings/integrations/TeamsIntegrationSettings.tsx');
    const contractsSource = readRepoFile('packages/integrations/src/actions/integrations/teamsContracts.ts');
    const sharedActionsSource = readRepoFile('packages/integrations/src/actions/integrations/teamsActions.ts');
    const eeActionsSource = readRepoFile('ee/packages/microsoft-teams/src/lib/actions/integrations/teamsActions.ts');

    // Banner element and conditional render: active integration + unconfigured connector.
    expect(uiSource).toContain('id="teams-bot-credentials-banner"');
    expect(uiSource).toContain("isActive && currentIntegration?.botConnectorConfigured === false");

    // i18n keys (with defaultValue fallbacks naming the required env vars and pointing at diagnostics).
    expect(uiSource).toContain('integrations.teams.settings.botCredentialsBanner.message');
    expect(uiSource).toContain('integrations.teams.settings.botCredentialsBanner.hint');
    expect(uiSource).toContain('TEAMS_BOT_APP_ID / TEAMS_BOT_APP_TENANT_ID / TEAMS_BOT_APP_PASSWORD');

    // The flag flows from the settings actions through the shared contract.
    expect(contractsSource).toContain('botConnectorConfigured: boolean');
    expect(sharedActionsSource).toContain('botConnectorConfigured: isBotConnectorConfiguredFromEnv()');
    expect(eeActionsSource).toContain("import { isBotConnectorConfigured } from '../../teams/bot/teamsBotConnector'");
    expect(eeActionsSource).toContain('botConnectorConfigured: isBotConnectorConfigured()');
  });

  it('T081: banner and channel translations exist in every locale', () => {
    for (const locale of LOCALES) {
      const source = JSON.parse(readLocale(locale));
      const settings = source.integrations.teams.settings;
      expect(settings.botCredentialsBanner, `${locale} botCredentialsBanner`).toBeTruthy();
      expect(typeof settings.botCredentialsBanner.message, `${locale} banner message`).toBe('string');
      expect(typeof settings.botCredentialsBanner.hint, `${locale} banner hint`).toBe('string');

      const channel = settings.notifications.channel;
      expect(channel, `${locale} notifications channel`).toBeTruthy();
      for (const key of ['label', 'activityFeed', 'botDm', 'both']) {
        expect(typeof channel[key], `${locale} channel.${key}`).toBe('string');
      }
    }
  });

  it('F045: renders a per-category channel picker with kebab-case ids for every notification category', () => {
    const uiSource = readRepoFile('packages/integrations/src/components/settings/integrations/TeamsIntegrationSettings.tsx');

    expect(uiSource).toContain("id={`notification-channel-select-${option.value.replace(/_/g, '-')}`}");
    expect(uiSource).toContain('getTeamsNotificationChannelOptions');
    expect(uiSource).toContain('integrations.teams.settings.notifications.channel.label');
    expect(uiSource).toContain('integrations.teams.settings.notifications.channel.activityFeed');
    expect(uiSource).toContain('integrations.teams.settings.notifications.channel.botDm');
    expect(uiSource).toContain('integrations.teams.settings.notifications.channel.both');
    // Defaults to activity feed when a category has no explicit preference.
    expect(uiSource).toContain("formState.notificationChannels[option.value] ?? 'activity_feed'");
    // Saved alongside the other notification settings.
    expect(uiSource).toContain('notificationChannels: formState.notificationChannels');
  });

  it('F045: persists notification_channels through both settings action mirrors', () => {
    const sharedActionsSource = readRepoFile('packages/integrations/src/actions/integrations/teamsActions.ts');
    const eeActionsSource = readRepoFile('ee/packages/microsoft-teams/src/lib/actions/integrations/teamsActions.ts');

    for (const source of [sharedActionsSource, eeActionsSource]) {
      expect(source).toContain('notification_channels: toJsonbValue(notificationChannels)');
      expect(source).toContain('notificationChannels: normalizeNotificationChannels(row.notification_channels)');
      expect(source).toContain('normalizeNotificationChannels(input.notificationChannels)');
    }
  });
});
