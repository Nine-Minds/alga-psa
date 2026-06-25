import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const files = [
  'BaseEmailService.ts',
  'templateProcessors.ts',
  'tenant/templateProcessors.ts',
  'system/SystemEmailService.ts',
  'sendVerificationEmail.ts',
  'emailLocaleResolver.ts',
  'actions/emailLogActions.ts',
  'TenantEmailService.ts',
];

describe('email tenant-scoped query contract', () => {
  it('uses structural tenant scoping for email tenant-owned roots', () => {
    for (const file of files) {
      const source = readFileSync(resolve(__dirname, file), 'utf8');
      expect(source).toContain('createTenantScopedQuery');
      expect(source).not.toMatch(/\.where\(\{\s*tenant[\s,:}]/);
      expect(source).not.toContain(".where('esl.tenant', tenant)");
      expect(source).not.toContain("knex('tenant_email_templates')");
      expect(source).not.toContain("this.knex('tenant_email_templates')");
      expect(source).not.toContain("knex('tenant_email_settings')");
    }
  });
});
