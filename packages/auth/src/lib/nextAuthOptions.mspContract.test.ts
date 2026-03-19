import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'nextAuthOptions.ts'), 'utf8');

describe('NextAuth MSP SSO contract', () => {
  it('T046: CE path can register Google and Microsoft OAuth providers when credentials are resolved', () => {
    expect(source).toContain('secrets.googleClientId && secrets.googleClientSecret');
    expect(source).toContain('GoogleProvider({');
    expect(source).toContain('secrets.microsoftClientId && secrets.microsoftClientSecret');
    expect(source).toContain('AzureADProvider({');
  });

  it('T047: auth options are rebuilt per request (no stale static cache)', () => {
    expect(source).toContain('export async function getAuthOptions(): Promise<NextAuthConfig> {');
    expect(source).toContain('return buildAuthOptions();');
    expect(source).not.toContain('cachedOptions');
  });

  it('T048/T049: OAuth secret resolver applies tenant source from valid resolver cookie for Microsoft and Google', () => {
    expect(source).toContain("if (resolution.provider === 'google') {");
    expect(source).toContain("getTenantSecret(resolution.tenantId, 'google_client_id')");
    expect(source).toContain("getTenantSecret(resolution.tenantId, 'google_client_secret')");

    expect(source).toContain("if (resolution.provider === 'azure-ad') {");
    expect(source).toContain('resolveMicrosoftConsumerProfileConfig(');
    expect(source).toContain("'msp_sso'");
    expect(source).not.toContain("getTenantSecret(resolution.tenantId, 'microsoft_client_id')");
  });

  it('T050/T051: invalid or expired resolver cookie contexts are ignored and app fallback remains in use', () => {
    expect(source).toContain('parseAndVerifyMspSsoResolutionCookie');
    expect(source).toContain("if (!resolution || resolution.source !== 'tenant' || !resolution.tenantId) {");
    expect(source).toContain('return resolved;');
  });

  it('T057: enterprise build path preserves registry-based OAuth mapper', () => {
    expect(source).toContain('if (isEnterprise) {');
    expect(source).toContain('return (await getSSORegistry().mapOAuthProfileToExtendedUser(input)) as ExtendedUser;');
  });

  it('T058: CE sign-in path does not require EE account-link persistence', () => {
    expect(source).toContain('async function ensureOAuthAccountLink(');
    expect(source).toContain('if (!isEnterprise) {');
    expect(source).toContain('return;');
  });

  it('T059: Microsoft OAuth issuer defaults tenant to common when tenant ID is empty', () => {
    expect(source).toContain("issuer: `https://login.microsoftonline.com/${secrets.microsoftTenantId || 'common'}/v2.0`");
    expect(source).toContain("issuer: `https://login.microsoftonline.com/${process.env.MICROSOFT_OAUTH_TENANT_ID || 'common'}/v2.0`");
  });

  it('T149/T150: Teams auth can build request-scoped Microsoft-only auth options from the tenant-selected Teams profile', () => {
    expect(source).toContain('import { resolveTeamsMicrosoftProviderConfig } from "./sso/teamsMicrosoftProviderResolution";');
    expect(source).toContain('if (context?.teamsTenantId) {');
    expect(source).toContain('const teamsMicrosoft = await resolveTeamsMicrosoftProviderConfig(context.teamsTenantId);');
    expect(source).toContain('export async function buildTeamsAuthOptions(tenantId: string): Promise<NextAuthConfig> {');
    expect(source).toContain('teamsTenantId: tenantId');
    expect(source).toContain('teamsMicrosoftOnly: true');
  });

  it('T265/T266: shared MSP SSO and non-Teams auth paths depend on the shared Teams auth wrapper rather than importing EE Teams auth modules directly', () => {
    expect(source).toContain('import { resolveTeamsMicrosoftProviderConfig } from "./sso/teamsMicrosoftProviderResolution";');
    expect(source).not.toContain('ee/server/src/lib/auth/teamsMicrosoftProviderResolution');
    expect(source).toContain('GoogleProvider({');
    expect(source).toContain('AzureADProvider({');
    expect(source).toContain('async function buildAuthOptions(');
  });
});
