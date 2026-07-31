import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function read(relativeFile: string): string {
  return fs.readFileSync(path.join(here, relativeFile), 'utf8');
}

describe('Client portal credentials regression contract', () => {
  it('T008/F022: client credentials sign-in path keeps existing callback and user_type behavior', () => {
    const source = read('ClientLoginForm.tsx');
    const signInPageSource = fs.readFileSync(
      path.resolve(here, '../../../../server/src/app/auth/client-portal/signin/page.tsx'),
      'utf8'
    );

    expect(source).toContain("signIn('credentials'");
    expect(source).toContain('callbackUrl,');
    expect(source).toContain("userType: 'client'");
    expect(signInPageSource).toContain("'/client-portal/dashboard'");
  });
});
