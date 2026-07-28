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
    const clientSource = read('../src/components/credits/CreditsTable.tsx');

    expect(pageSource).toContain("import CreditsPageClient from './CreditsPageClient';");
    expect(clientSource).toContain("const { t } = useTranslation('msp/credits');");
    expect(clientSource).toContain("t('columns.client', { defaultValue: 'Client' })");
    expect(clientSource).toContain("t('columns.description', { defaultValue: 'Description' })");
    expect(clientSource).toContain("t('columns.balance', { defaultValue: 'Balance' })");
    expect(clientSource).toContain("t('columns.expires', { defaultValue: 'Expires' })");
    expect(clientSource).toContain("t('columns.status', { defaultValue: 'Status' })");
    expect(clientSource).toContain("t('columns.actions', { defaultValue: 'Actions' })");
  });

  it('T006: CreditsPage table wires status labels through msp/credits', () => {
    const tableSource = read('../src/components/credits/CreditsTable.tsx');

    expect(tableSource).toContain("t('status.expired', { defaultValue: 'Expired' })");
    expect(tableSource).toContain("t('status.active', { defaultValue: 'Active' })");
    expect(tableSource).toContain("t('status.expiringSoon', {");
    expect(tableSource).toContain("t('status.depleted', { defaultValue: 'Depleted' })");
  });

  it('T007: CreditsPage expiration caption resolves its labels through msp/credits', () => {
    const source = read('../src/components/credits/CreditsPageClient.tsx');

    expect(source).toContain("t('settings.captionEnabled', {");
    expect(source).toContain("t('settings.captionDisabled', {");
    expect(source).toContain("t('settings.captionReminders', {");
    expect(source).toContain("t('settings.editInSettings', {");
    expect(source).toContain("t('settings.loadErrorPrefix', {");
  });

  it('T008: xx pseudo-locale backs the representative CreditsPage shell keys', () => {
    const pseudo = readJson<Record<string, unknown>>(
      '../../../server/public/locales/xx/msp/credits.json',
    );

    const pseudoKeys = [
      'page.title',
      'settings.editInSettings',
      'columns.client',
      'columns.status',
      'status.depleted',
      'filters.allClients',
    ];

    for (const key of pseudoKeys) {
      expect(getLeaf(pseudo, key)).toBe('11111');
    }

    expect(getLeaf(pseudo, 'status.expiringSoon_other')).toBe('11111 {{count}} 11111');
  });
});
