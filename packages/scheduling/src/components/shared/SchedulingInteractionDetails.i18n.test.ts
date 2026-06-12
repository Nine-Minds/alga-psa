// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
const locale = (loc: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../../../server/public/locales/${loc}/msp/schedule.json`), 'utf8'));

describe('SchedulingInteractionDetails i18n wiring', () => {
  it('uses msp/schedule interactionDetails keys with no hardcoded field labels', () => {
    const source = read('./SchedulingInteractionDetails.tsx');
    expect(source).toContain("useTranslation('msp/schedule')");
    expect(source).toContain("t('interactionDetails.title'");
    expect(source).toContain("t('interactionDetails.fields.duration'");
    expect(source).not.toMatch(/>\s*Interaction Details\s*</);
    expect(source).not.toMatch(/>\s*Duration\s*</);
  });

  it('interactionDetails keys exist in en and all production locales', () => {
    for (const loc of ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl', 'pt']) {
      const data = locale(loc);
      expect(data.interactionDetails.title, `${loc} title`).toBeTruthy();
      expect(data.interactionDetails.fields.duration, `${loc} duration`).toBeTruthy();
      expect(data.interactionDetails.noClient, `${loc} noClient`).toBeTruthy();
    }
  });
});
