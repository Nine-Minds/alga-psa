import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getNamespacesForRoute } from '@alga-psa/core/lib/i18n/config';

const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'xx', 'yy'];

function locale(locale: string) {
  return JSON.parse(fs.readFileSync(
    path.resolve(__dirname, `../../../server/public/locales/${locale}/msp/opportunities.json`),
    'utf8',
  )) as Record<string, unknown>;
}

describe('msp/opportunities translation namespace', () => {
  it('is loaded for the hub and detail routes', () => {
    expect(getNamespacesForRoute('/msp/opportunities')).toContain('msp/opportunities');
    expect(getNamespacesForRoute('/msp/opportunities/opportunity-1')).toContain('msp/opportunities');
  });

  it('ships the namespace in every supported and pseudo locale', () => {
    for (const code of LOCALES) {
      expect(locale(code)).toHaveProperty('opportunities.queue.needsYou_other');
      expect(locale(code)).toHaveProperty('opportunities.suggestedActions.scheduleDiscovery');
      expect(locale(code)).toHaveProperty('opportunities.why.actionDue.pastDue_other');
    }
  });

  it('keeps pseudo-locales visibly distinct from English', () => {
    expect(locale('xx')).toHaveProperty('opportunities.pageTitle', '11111');
    expect(locale('yy')).toHaveProperty('opportunities.pageTitle', '55555');
  });
});
