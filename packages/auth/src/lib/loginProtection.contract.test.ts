import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function read(relativeFile: string): string {
  return fs.readFileSync(path.join(here, relativeFile), 'utf8');
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('credentials login protection contract', () => {
  it('gates both credentials providers through enforceLoginProtection', () => {
    const source = read('nextAuthOptions.ts');

    // Both active CredentialsProvider authorize() callbacks must enforce the gate,
    // record failures for bad passwords and bad 2FA codes, and clear on success.
    expect(countOccurrences(source, 'await enforceLoginProtection({')).toBe(2);
    expect(countOccurrences(source, 'await recordLoginFailure(attemptContext);')).toBe(4);
    expect(countOccurrences(source, 'await recordLoginSuccess(attemptContext);')).toBe(2);
    expect(countOccurrences(source, "captchaToken: { label: \"Captcha Token\", type: \"text\" },")).toBe(2);
  });

  it('never logs the NextAuth secret', () => {
    const source = read('nextAuthOptions.ts');
    expect(source).not.toContain("console.log('next auth secret'");
    expect(source).not.toMatch(/console\.\w+\([^)]*process\.env\.NEXTAUTH_SECRET/);
  });

  it('surfaces RATE_LIMITED and CAPTCHA_REQUIRED codes to both login forms', () => {
    const mspForm = read('../components/MspLoginForm.tsx');
    const clientForm = read('../components/ClientLoginForm.tsx');

    for (const formSource of [mspForm, clientForm]) {
      expect(formSource).toContain("'CAPTCHA_REQUIRED'");
      expect(formSource).toContain("'RATE_LIMITED'");
      expect(formSource).toContain('CaptchaChallenge');
      expect(formSource).toContain('useLoginCaptcha');
      expect(formSource).toContain('captchaToken');
    }
  });
});
