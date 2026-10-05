import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../../..');
const localesDir = path.join(repoRoot, 'server/public/locales');
const LOCALES = ['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'xx', 'yy'];

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function get(obj: any, dottedKey: string): unknown {
  return dottedKey.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), obj);
}

const panelSource = fs.readFileSync(path.resolve(__dirname, 'ThreecxIntegrationSettings.tsx'), 'utf8');
const referencedKeys = [...panelSource.matchAll(/t\('(integrations\.telephony\.providers\.threecx\.[^']+)'/g)].map(
  (m) => m[1],
);

const chooserSource = fs.readFileSync(path.resolve(__dirname, 'TelephonyIntegrationSettings.tsx'), 'utf8');
const setupKeys = [...chooserSource.matchAll(/t\('(integrations\.telephony\.setup\.[^']+)'/g)].map((m) => m[1]);

describe('3CX settings i18n', () => {
  it('T125: every threecx.* key referenced by the panel exists in the en pack', () => {
    expect(referencedKeys.length).toBeGreaterThan(0);
    const en = readJson(path.join(localesDir, 'en/msp/integrations.json'));
    for (const key of referencedKeys) {
      expect(get(en, key), `missing en key ${key}`).toEqual(expect.any(String));
    }
  });

  it('T128: the tier_required message and the PBX_TELEPHONY label exist in every locale', () => {
    for (const locale of LOCALES) {
      const integrations = readJson(path.join(localesDir, locale, 'msp/integrations.json'));
      expect(
        get(integrations, 'integrations.telephony.providers.threecx.tierRequired'),
        `missing tierRequired in ${locale}`,
      ).toEqual(expect.any(String));

      const account = readJson(path.join(localesDir, locale, 'msp/account.json'));
      expect(get(account, 'features.pbxTelephony'), `missing pbxTelephony label in ${locale}`).toEqual(
        expect.any(String),
      );
    }
  });

  it('every telephony.setup.* key the provider chooser renders exists in every locale', () => {
    expect(setupKeys.length).toBeGreaterThan(0);
    for (const locale of LOCALES) {
      const integrations = readJson(path.join(localesDir, locale, 'msp/integrations.json'));
      for (const key of setupKeys) {
        expect(get(integrations, key), `missing ${key} in ${locale}`).toEqual(expect.any(String));
      }
    }
  });
});
