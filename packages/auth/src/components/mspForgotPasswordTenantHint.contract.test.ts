import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-level contract for the MSP tenant hint (T008): the scoped sign-in
// links to the scoped forgot-password page, which hands the slug to
// recoverPassword. Resolution itself is covered by the subject-module tests and
// the DB-backed integration suite.
const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('MSP forgot-password tenant hint', () => {
  it('scoped sign-in links to /auth/msp/forgot-password?tenant=<slug>; unscoped stays bare', () => {
    const source = read('./MspLoginForm.tsx');
    expect(source).toContain('`/auth/msp/forgot-password?tenant=${encodeURIComponent(tenantSlug)}`');
    expect(source).toContain(": '/auth/msp/forgot-password'");
  });

  it('the forgot-password page reads ?tenant and passes it as the tenantSlug hint', () => {
    const source = read('../../../../server/src/app/auth/msp/forgot-password/page.tsx');
    expect(source).toContain("useSearchParams().get('tenant')");
    expect(source).toContain("recoverPassword(formData.email, 'msp', { tenantSlug })");
  });

  it('every in-repo caller passes hints through the options form', () => {
    expect(read('../../../../server/src/app/auth/client-portal/forgot-password/ClientPortalForgotPassword.tsx'))
      .toContain("recoverPassword(formData.email, 'client', { portalDomain })");
    expect(read('../../../../server/src/app/auth/check-email/CheckEmailClient.tsx'))
      .toContain("portal === 'client' ? { portalDomain } : { tenantSlug }");
  });

  it('no reset path looks a user up with the unscoped first() lookup', () => {
    for (const file of ['../actions/useRegister.tsx', '../lib/passwordReset/resolveResetSubjects.ts', '../lib/passwordReset/resolveResetSubjectFromToken.ts']) {
      expect(read(file)).not.toContain('findUserByEmailAndType');
    }
  });
});
