// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
const locale = (loc: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../../../server/public/locales/${loc}/msp/clients.json`), 'utf8'));

describe('interactions feeds i18n wiring', () => {
  it('InteractionsFeed uses msp/clients interactions.feed keys', () => {
    const source = read('./InteractionsFeed.tsx');
    expect(source).toContain("useTranslation('msp/clients')");
    expect(source).toContain("t('interactions.feed.title'");
    expect(source).toContain("t('interactions.feed.searchPlaceholder'");
    expect(source).toContain("t('interactions.feed.applyFilters'");
    expect(source).not.toMatch(/>\s*Add Interaction\s*</);
    expect(source).not.toMatch(/placeholder="Search interactions"/);
  });

  it('OverallInteractionsFeed uses msp/clients interactions.feed/overall keys', () => {
    const source = read('./OverallInteractionsFeed.tsx');
    expect(source).toContain("useTranslation('msp/clients')");
    expect(source).toContain("t('interactions.overall.title'");
    expect(source).toContain("t('interactions.overall.byUser'");
    expect(source).toContain("t('interactions.feed.filterDialogTitle'");
    expect(source).not.toMatch(/>\s*Recent Interactions\s*</);
  });

  it('feed keys exist in en and all production locales', () => {
    for (const loc of ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl', 'pt']) {
      const data = locale(loc);
      expect(data.interactions.feed.title, `${loc} feed.title`).toBeTruthy();
      expect(data.interactions.feed.applyFilters, `${loc} feed.applyFilters`).toBeTruthy();
      expect(data.interactions.overall.title, `${loc} overall.title`).toBeTruthy();
      expect(data.interactions.overall.byUser, `${loc} overall.byUser`).toContain('{{name}}');
    }
  });
});
