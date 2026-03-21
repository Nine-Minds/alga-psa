import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const contractActionsSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/actions/contractActions.ts'),
  'utf8',
);

describe('system-managed contract action guardrails wiring', () => {
  it('F049: contract actions enforce billing permission checks for view and mutation routes', () => {
    expect(contractActionsSource).toContain("await assertBillingPermission(user, 'read', 'view billing contracts')");
    expect(contractActionsSource).toContain("await assertBillingPermission(user, 'create', 'create billing contracts')");
    expect(contractActionsSource).toContain("await assertBillingPermission(user, 'update', 'update billing contracts')");
  });

  it('F050: create/update paths reject mutation of system-managed identity fields', () => {
    expect(contractActionsSource).toContain('const assertNoSystemManagedIdentityMutation =');
    expect(contractActionsSource).toContain("'is_system_managed_default'");
    expect(contractActionsSource).toContain("'owner_client_id'");
    expect(contractActionsSource).toContain('assertNoSystemManagedIdentityMutation(contractData as Record<string, unknown>, \'create\')');
    expect(contractActionsSource).toContain('assertNoSystemManagedIdentityMutation(updateData as Record<string, unknown>, \'update\')');
  });
});
