import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const componentSource = fs.readFileSync(
  path.resolve(__dirname, '../../components/settings/account/AccountManagement.tsx'),
  'utf8',
);

describe('AccountManagement tier feature labels', () => {
  it('maps PBX_TELEPHONY to a translation key', () => {
    expect(componentSource).toContain("[TIER_FEATURES.PBX_TELEPHONY]: 'features.pbxTelephony'");
  });

  it('resolves features.pbxTelephony to a translated string in the en locale', () => {
    const account = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../../../../server/public/locales/en/msp/account.json'),
        'utf8',
      ),
    );
    expect(typeof account.features.pbxTelephony).toBe('string');
    expect(account.features.pbxTelephony.length).toBeGreaterThan(0);
  });
});
