// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

function getLeaf(record: Record<string, unknown>, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[key];
  }, record);
}

describe('CreditsPage i18n wiring contract', () => {
  it('T005: CreditsPage client wrapper wires translated credits-table column titles through msp/credits', () => {
    const pageSource = read('../src/components/credits/CreditsPage.tsx');
    const clientSource = read('../src/components/credits/CreditsPageClient.tsx');

    expect(pageSource).toContain("import CreditsPageClient from './CreditsPageClient';");
    expect(clientSource).toContain("const { t } = useTranslation('msp/credits');");
    expect(clientSource).toContain("t('columns.creditId', { defaultValue: 'Credit ID' })");
    expect(clientSource).toContain("t('columns.created', { defaultValue: 'Created' })");
    expect(clientSource).toContain("t('columns.description', { defaultValue: 'Description' })");
    expect(clientSource).toContain("t('columns.originalAmount', { defaultValue: 'Original Amount' })");
    expect(clientSource).toContain("t('columns.remaining', { defaultValue: 'Remaining' })");
    expect(clientSource).toContain("t('columns.expires', { defaultValue: 'Expires' })");
    expect(clientSource).toContain("t('columns.status', { defaultValue: 'Status' })");
    expect(clientSource).toContain("t('columns.actions', { defaultValue: 'Actions' })");
  });

  it('T006: CreditsPage client wrapper wires status labels and tab labels through msp/credits', () => {
    const source = read('../src/components/credits/CreditsPageClient.tsx');

    expect(source).toContain("t('status.expired', { defaultValue: 'Expired' })");
    expect(source).toContain("t('status.active', { defaultValue: 'Active' })");
    expect(source).toContain("t('status.expiringSoon', {");
    expect(source).toContain("t('tabs.activeCredits', { defaultValue: 'Active Credits' })");
    expect(source).toContain("t('tabs.allCredits', { defaultValue: 'All Credits' })");
    expect(source).toContain("t('tabs.expiredCredits', { defaultValue: 'Expired Credits' })");
  });

  it('T007: CreditsPage settings summary resolves all settings labels through msp/credits', () => {
    const source = read('../src/components/credits/CreditsPageClient.tsx');

    expect(source).toContain("t('settings.title', { defaultValue: 'Credit Expiration Settings' })");
    expect(source).toContain("t('settings.creditExpiration', { defaultValue: 'Credit Expiration:' })");
    expect(source).toContain("t('settings.enabled', { defaultValue: 'Enabled' })");
    expect(source).toContain("t('settings.disabled', { defaultValue: 'Disabled' })");
    expect(source).toContain("t('settings.expirationPeriod', { defaultValue: 'Expiration Period:' })");
    expect(source).toContain("t('settings.notificationDays', { defaultValue: 'Notification Days:' })");
    expect(source).toContain("t('settings.none', { defaultValue: 'None' })");
  });

  it('T008: xx pseudo-locale backs the representative CreditsPage shell keys', () => {
    const pseudo = readJson<Record<string, unknown>>(
      '../../../server/public/locales/xx/msp/credits.json',
    );

    const pseudoKeys = [
      'page.title',
      'page.creditsOverview',
      'tabs.activeCredits',
      'tabs.allCredits',
      'tabs.expiredCredits',
      'settings.title',
      'columns.creditId',
      'columns.status',
      'page.expirationSummary',
      'page.usageTrends',
    ];

    for (const key of pseudoKeys) {
      expect(getLeaf(pseudo, key)).toBe('11111');
    }

    expect(getLeaf(pseudo, 'status.expiringSoon')).toBe('11111 {{days}} 11111');
  });
});
