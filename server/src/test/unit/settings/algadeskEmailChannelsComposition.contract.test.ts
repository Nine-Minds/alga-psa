import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('AlgaDesk email settings composition', () => {
  it('T021: uses focused EmailProviderConfiguration for AlgaDesk email channels settings', () => {
    const settingsPagePath = path.resolve(__dirname, '../../../app/msp/settings/email/EmailSettingsBody.tsx');
    const source = fs.readFileSync(settingsPagePath, 'utf8');

    expect(source).toContain("import { EmailProviderConfiguration } from '@alga-psa/integrations/components/email/EmailProviderConfiguration';");
    expect(source).toContain('{isAlgaDesk ? <EmailProviderConfiguration /> : <EmailSettings />}');
  });
});
