import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'emailBrandingActions.ts'), 'utf8');

describe('email branding actions contract', () => {
  it('reads and writes every table through tenant-scoped builders', () => {
    expect(source).toContain('function tenantScopedTable');
    expect(source).toContain('tenantDb(conn, tenant).table(table)');
    expect(source).toContain("tenantScopedTable(trx, 'tenant_settings', tenant)");
    expect(source).toContain('tenantScopedTable(trx, "system_email_templates as t", tenant)');
    expect(source).toContain('tenantScopedTable(trx, "tenant_email_templates", tenant)');

    // No raw table access that could reach another tenant's rows.
    expect(source).not.toMatch(/\btrx\(["'](tenant_email_templates|system_email_templates|tenant_settings)/);
    expect(source).not.toContain('createTenantScopedQuery');
  });

  it('gates every write on settings:update', () => {
    expect(source).toContain("hasPermission(user, 'settings', 'update', trx)");
    expect(source).toContain("throw new Error('Permission denied: Cannot update settings')");

    for (const action of ['saveEmailBrandingAction', 'applyEmailBrandingAction', 'removeEmailBrandingAction']) {
      const body = source.slice(source.indexOf(`export const ${action}`));
      expect(body.slice(0, body.indexOf('});'))).toContain('requireSettingsUpdate(user, trx)');
    }
  });

  it('writes templates in batches inside a transaction per language', () => {
    const apply = source.slice(source.indexOf('export const applyEmailBrandingAction'));

    expect(apply).toContain('for (const language of scope.languages)');
    expect(apply).toContain('await withTransaction(knex, async (trx: Knex.Transaction) => {');
    expect(apply).toContain('chunked(inserts, INSERT_BATCH_SIZE)');
    // Citus rejects column references in the SET clause of a distributed table.
    expect(apply).toContain(".update({ html_content: update.html, updated_at: now })");
    expect(apply).not.toMatch(/\.update\([^)]*knex\.raw/);
    // text_content is never rewritten on an existing row.
    expect(apply).not.toMatch(/\.update\(\{[^}]*text_content/);
  });

  it('runs every action under withAuth so the tenant comes from the session', () => {
    const exported = [...source.matchAll(/export const (\w+) = withAuth\(/g)].map((match) => match[1]);
    expect(exported).toContain('saveEmailBrandingAction');
    expect(exported).toContain('getEmailBrandingStatusAction');
    expect(exported).toContain('applyEmailBrandingAction');
    expect(exported).toContain('removeEmailBrandingAction');

    // A tenant argument would let a caller name someone else's tenant.
    expect(source).not.toMatch(/export const \w+ = async \(\s*tenant: string/);
  });

  it('enforces the Enterprise-only fields server side', () => {
    expect(source).toContain('normalizeEmailBrandingInput(input, isEnterprise)');
  });
});
