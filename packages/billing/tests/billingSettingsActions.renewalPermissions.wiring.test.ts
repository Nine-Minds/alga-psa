import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/billingSettingsActions.ts', import.meta.url),
  'utf8'
);

describe('billingSettingsActions renewal permission wiring', () => {
  it('enforces billing_settings update permission on renewal-default update endpoint', () => {
    expect(source).toContain("import { hasPermission } from '@alga-psa/auth/rbac';");
    expect(source).toContain("const requireBillingSettingsUpdatePermission = async (user: unknown): Promise<ActionPermissionError | null> => {");
    expect(source).toContain("if (!await hasPermission(user as any, 'billing_settings', 'update')) {");
    expect(source).toContain("return permissionError('Permission denied: Cannot update billing settings');");
    expect(source).toContain("export const updateDefaultBillingSettings = withAuth(async (");
    expect(source).toContain('requireBillingSettingsUpdatePermission(user);');
  });
});
