import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function read(relativeFile: string): string {
  return fs.readFileSync(path.join(here, relativeFile), 'utf8');
}

describe('MSP credentials flow contract', () => {
  it('T046: credentials login path remains unaffected by resolver cookie behavior', () => {
    const formSource = read('MspLoginForm.tsx');

    expect(formSource).toContain("signIn('credentials'");
    expect(formSource).toContain('userType: \'internal\'');
    expect(formSource).not.toContain('msp_sso_resolution');
    expect(formSource).not.toContain('parseAndVerifyMspSsoResolutionCookie');
  });
});
