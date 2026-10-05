import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

function read(relPath: string): string {
  return fs.readFileSync(path.resolve(repoRoot, relPath), 'utf8');
}

describe('Client portal vanity-domain tenant scoping contract', () => {
  it('signin page resolves the tenant from the vanity host and never renders an unscoped form', () => {
    const source = read('server/src/app/auth/client-portal/signin/page.tsx');

    expect(source).toContain('getTenantSlugByDomain');
    expect(source).toContain('portalDomain ? (await getTenantSlugByDomain(portalDomain)) ?? undefined : undefined');
    // Unresolvable vanity host falls into the same branch as "no tenant at all":
    // the login-links discovery form, not a credentials form without a tenant.
    expect(source).toContain('if (!tenantSlug) {');
    expect(source).toContain('<ClientPortalTenantDiscovery callbackUrl={callbackUrl} />');
    expect(source).toContain('tenantSlug={tenantSlug}');
  });

  it('tenancy exposes the active-only portal domain to tenant resolution', () => {
    const source = read('packages/tenancy/src/actions/tenant-actions/getTenantBrandingByDomain.ts');

    expect(source).toContain('export async function getTenantSlugByDomain');
    expect(source).toContain('buildTenantPortalSlug(tenantId)');
    // Branding tolerates non-active rows; sign-in scoping must not.
    expect(source).toContain(".andWhere('status', 'active')");
    expect(source).toContain("tags: ['tenant-portal-config']");
  });

  it('ClientPortalSignIn prefers the server-resolved tenant slug over the query param', () => {
    const source = read('packages/auth/src/components/ClientPortalSignIn.tsx');

    expect(source).toContain('tenantSlug: tenantSlugProp');
    expect(source).toContain("const slug = tenantSlugProp || searchParams?.get('tenant') || '';");
    expect(source).toContain('tenantSlug={tenantSlug}');
  });

  it('ClientLoginForm sends the tenant and the portal domain with the credentials call', () => {
    const source = read('packages/auth/src/components/ClientLoginForm.tsx');

    expect(source).toContain('signInPayload.tenant = tenantSlug;');
    expect(source).toContain('signInPayload.portalDomain = portalDomain;');
  });

  it('ClientLoginForm surfaces TENANT_REQUIRED as a choose-your-organization prompt', () => {
    const source = read('packages/auth/src/components/ClientLoginForm.tsx');

    expect(source).toContain("result.code === 'TENANT_REQUIRED'");
    expect(source).toContain('setTenantRequired(true)');
    expect(source).toContain("t('auth.tenantRequiredMessage'");
    expect(source).toContain('href="/auth/client-portal/signin"');

    // The ambiguity is not a failed attempt, so it must not recycle the captcha
    // challenge the invalid-credentials branch refreshes.
    const tenantRequiredBranch = source.slice(
      source.indexOf("result.code === 'TENANT_REQUIRED'"),
      source.indexOf('} else {', source.indexOf("result.code === 'TENANT_REQUIRED'")),
    );
    expect(tenantRequiredBranch).not.toContain('captcha.refreshChallenge()');
  });

  it('both credentials providers accept and forward the portalDomain hint', () => {
    const source = read('packages/auth/src/lib/nextAuthOptions.ts');

    const credentialDeclarations = source.split('portalDomain: { label: "Portal Domain", type: "text" },').length - 1;
    const forwardedHints = source.split('portalDomain: portalDomainHint,').length - 1;

    expect(credentialDeclarations).toBe(2);
    expect(forwardedHints).toBe(2);
  });

  it('TENANT_REQUIRED is a CredentialsSignin code alongside the other login gates', () => {
    const source = read('packages/auth/src/lib/security/loginProtection.ts');

    expect(source).toContain('export class TenantRequiredError extends CredentialsSignin');
    expect(source).toContain("code = 'TENANT_REQUIRED'");
  });

  it('unscoped client discovery reads every match instead of an arbitrary first row', () => {
    const modelSource = read('packages/db/src/models/user.ts');
    const authSource = read('packages/auth/src/actions/auth.tsx');

    expect(modelSource).toContain('findUsersByEmailAndType');
    expect(authSource).toContain('User.findUsersByEmailAndType(normalizedEmail, \'client\')');
    expect(authSource).toContain('new TenantRequiredError()');
  });
});
