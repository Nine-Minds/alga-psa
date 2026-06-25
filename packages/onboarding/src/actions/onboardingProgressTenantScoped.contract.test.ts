import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'onboarding-progress.ts');
const source = readFileSync(sourcePath, 'utf8');

describe('onboarding progress tenant-scoped query contract', () => {
  it('uses structural tenant scoping for progress aggregate roots', () => {
    expect(source).toContain('createTenantScopedQuery(adminDb, {');
    expect(source).toContain("table: 'user_auth_accounts'");
    expect(source).toContain("table: 'tenant_settings'");
    expect(source).toContain("table: 'portal_invitations'");
    expect(source).toContain("table: 'contacts'");
    expect(source).toContain("table: 'calendar_providers'");
    expect(source).toContain("table: 'email_providers'");

    expect(source).not.toMatch(/(?:adminDb|knex)\('(?:user_auth_accounts|tenant_settings|portal_invitations|contacts|calendar_providers|email_providers)'\)\s*[\r\n]+\s*\.where\(\{\s*tenant: tenantId\s*\}\)/);
  });
});
