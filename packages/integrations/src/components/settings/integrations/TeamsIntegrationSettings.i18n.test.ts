import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../..');
const localesRoot = path.resolve(repoRoot, 'server/public/locales');

const REQUIRED_DIAGNOSTICS_KEYS = [
  'title',
  'description',
  'run',
  'running',
  'sendTest',
  'sending',
  'disabled',
  'completedAt',
  'lastSuccess',
  'lastFailure',
  'noneRecorded',
  'recommendations',
  'status.pass',
  'status.warn',
  'status.fail',
  'status.skip',
  'errors.run',
  'errors.testMessage',
  'steps.addonEntitlement',
  'steps.integrationStatus',
  'steps.capabilities',
  'steps.microsoftProfile',
  'steps.packageMetadata',
  'steps.botConnector',
  'steps.userLinkage',
  'steps.conversationReference',
  'steps.recentDeliveryHealth',
  'recommendation.addon',
  'recommendation.activate',
  'recommendation.capabilities',
  'recommendation.profile',
  'recommendation.activeProfile',
  'recommendation.profileCredentials',
  'recommendation.package',
  'recommendation.baseUrl',
  'recommendation.botEnv',
  'recommendation.userLinkage',
  'recommendation.conversationReference',
  'recommendation.deliveryFailure',
] as const;

const TEST_RESULT_REASON_KEYS = [
  'sent',
  'failed',
  'addonInactive',
  'integrationInactive',
  'capabilityDisabled',
  'botNotConfigured',
  'missingUserLinkage',
  'missingConversationReference',
  'skipped',
] as const;

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function getPathValue(source: unknown, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, source);
}

function listIntegrationLocaleFiles(): string[] {
  return fs.readdirSync(localesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.resolve(localesRoot, entry.name, 'msp/integrations.json'))
    .filter((filePath) => fs.existsSync(filePath));
}

describe('TeamsIntegrationSettings diagnostics i18n coverage', () => {
  it('defines all diagnostics keys in every integrations locale file', () => {
    const localeFiles = listIntegrationLocaleFiles();
    expect(localeFiles.length).toBeGreaterThan(0);

    for (const filePath of localeFiles) {
      const locale = readJson(filePath);

      for (const key of REQUIRED_DIAGNOSTICS_KEYS) {
        const value = getPathValue(locale, `integrations.teams.settings.diagnostics.${key}`);
        expect(value, `${filePath} is missing diagnostics.${key}`).toEqual(expect.any(String));
        expect(value).not.toBe(`integrations.teams.settings.diagnostics.${key}`);
      }
    }
  });

  it('defines every test-message skip/fail reason key', () => {
    for (const filePath of listIntegrationLocaleFiles()) {
      const locale = readJson(filePath);

      for (const key of TEST_RESULT_REASON_KEYS) {
        const value = getPathValue(locale, `integrations.teams.settings.diagnostics.test.${key}`);
        expect(value, `${filePath} is missing diagnostics.test.${key}`).toEqual(expect.any(String));
        expect(value).not.toBe(`integrations.teams.settings.diagnostics.test.${key}`);
      }
    }
  });
});
