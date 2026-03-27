import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../../../../../../..');
const pageSource = fs.readFileSync(
  path.join(repoRoot, 'server/src/app/auth/msp/signin/page.tsx'),
  'utf8'
);
const formSource = fs.readFileSync(
  path.join(repoRoot, 'packages/auth/src/components/MspLoginForm.tsx'),
  'utf8'
);

describe('MSP remembered-email prefill contract', () => {
  it('T012: the durable remembered-email cookie is read server-side for page prefill rather than from browser storage in the form component', () => {
    expect(pageSource).toContain("import { cookies } from 'next/headers.js'");
    expect(pageSource).toContain('MSP_REMEMBERED_EMAIL_COOKIE');
    expect(pageSource).toContain('cookieStore.get(MSP_REMEMBERED_EMAIL_COOKIE)');

    expect(formSource).not.toContain('localStorage');
    expect(formSource).not.toContain('document.cookie');
    expect(formSource).not.toContain('cookies-next');
  });
});
