// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
const enLocale = (ns: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../../server/public/locales/en/${ns}.json`), 'utf8'));
const xxLocale = (ns: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../../server/public/locales/xx/${ns}.json`), 'utf8'));

const jsxTextLiterals = (source: string) =>
  Array.from(source.matchAll(/>\s*([A-Z][A-Za-z][A-Za-z .]{2,})\s*</g)).map((m) => m[1]);

describe('msp-composition client/contact tab i18n wiring', () => {
  it('MspClientTickets uses msp/clients clientTabs.tickets keys with no hardcoded chrome', () => {
    const source = read('./MspClientTickets.tsx');
    expect(source).toContain("useTranslation('msp/clients')");
    expect(source).toContain("t('clientTabs.tickets.title'");
    expect(source).toContain("t('clientTabs.tickets.filters.searchPlaceholder'");
    expect(source).toContain("t('clientTabs.tickets.loadMore.label'");
    expect(jsxTextLiterals(source)).toEqual([]);
  });

  it('MspClientAssets uses msp/clients clientTabs.assets keys with no hardcoded chrome', () => {
    const source = read('./MspClientAssets.tsx');
    expect(source).toContain("useTranslation('msp/clients')");
    expect(source).toContain("t('clientTabs.assets.types.all'");
    expect(source).toContain("t('clientTabs.assets.inventory.title'");
    expect(source).toContain("t('clientTabs.assets.columns.assetTag'");
    expect(jsxTextLiterals(source)).toEqual([]);
  });

  it('MspContactTickets uses msp/contacts contactTabs.tickets keys with no hardcoded chrome', () => {
    const source = read('./MspContactTickets.tsx');
    expect(source).toContain("useTranslation('msp/contacts')");
    expect(source).toContain("t('contactTabs.tickets.title'");
    expect(source).toContain("t('contactTabs.tickets.empty'");
    expect(jsxTextLiterals(source)).toEqual([]);
  });

  it('all referenced keys exist in en and xx locales', () => {
    const clients = enLocale('msp/clients');
    const contacts = enLocale('msp/contacts');
    const clientsXx = xxLocale('msp/clients');

    expect(clients.clientTabs.tickets.title).toBe('Tickets');
    expect(clients.clientTabs.tickets.filters.searchPlaceholder).toBe('Search tickets...');
    expect(clients.clientTabs.assets.loading).toBe('Loading assets...');
    expect(clients.clientTabs.assets.types.all).toBe('All Asset Types');
    expect(contacts.contactTabs.tickets.title).toBe('Contact Tickets');
    expect(contacts.contactTabs.tickets.empty).toBe('No tickets found for this contact');

    expect(clientsXx.clientTabs.tickets.title).toContain('11111');
    expect(clientsXx.clientTabs.assets.loading).toContain('11111');
  });
});
