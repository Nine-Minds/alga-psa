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
      expect(source).toContain('tenantDb');
      expect(source).not.toContain('createTenantScopedQuery');
      expect(source).not.toMatch(/\.where\(\{\s*tenant[\s,:}]/);
      expect(source).not.toContain(".where('esl.tenant', tenant)");
      expect(source).not.toContain("knex('tenant_email_templates')");
      expect(source).not.toContain("this.knex('tenant_email_templates')");
      expect(source).not.toContain("knex('tenant_email_settings')");
    }
  });

  it('routes email_sending_logs inserts through the tenant facade', () => {
    const source = readFileSync(resolve(__dirname, 'BaseEmailService.ts'), 'utf8');

    expect(source).toMatch(
      /tenantScopedTable\(knex,\s*BaseEmailService\.EMAIL_LOG_TABLE,\s*params\.tenantId\)\.insert\(\{/
    );
    expect(source).not.toContain('knex(BaseEmailService.EMAIL_LOG_TABLE).insert');
  });
});
