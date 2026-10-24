import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CE authorization bundle management placeholder', () => {
  it('shows upgrade guidance while explicitly preserving builtin authorization behavior', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), '../packages/ee/src/components/settings/policy/PolicyManagement.tsx'),
      'utf8'
    );

    // The copy is now localized (msp/settings namespace) rather than hardcoded;
    // assert the wiring plus the English resource it resolves through.
    expect(source).toContain("useTranslation('msp/settings')");
    expect(source).toContain('policyManagement.bundleLibrary.upgradeDescription');
    expect(source).toContain('policyManagement.bundleLibrary.protectionsDescription');

    const en = JSON.parse(
      fs.readFileSync(
        path.resolve(process.cwd(), 'public/locales/en/msp/settings.json'),
        'utf8'
      )
    );

    expect(en.policyManagement.bundleLibrary.upgradeDescription).toContain('available on Pro');
    expect(en.policyManagement.bundleLibrary.upgradeDescription).toContain(
      'configure narrowing bundles for roles, teams, users, and API keys'
    );
    expect(en.policyManagement.bundleLibrary.protectionsDescription).toContain(
      'Built-in authorization protections remain active'
    );
  });
});
