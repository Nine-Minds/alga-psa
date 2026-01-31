import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('SsoProviderButtons wiring', () => {
  it('uses the stable @alga-psa/auth/sso/entry import (allows EE/CE swapping)', () => {
    const componentsDir = __dirname;
    const files = ['MspLoginForm.tsx', 'ClientLoginForm.tsx'];

    for (const file of files) {
      const filePath = path.join(componentsDir, file);
      const contents = fs.readFileSync(filePath, 'utf8');
      expect(contents).toContain("from '@alga-psa/auth/sso/entry'");
      expect(contents).not.toContain("from './SsoProviderButtons'");
    }
  });
});
