import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const contractActionsSource = readFileSync(
  resolve(__dirname, '../../../../../packages/billing/src/actions/contractActions.ts'),
  'utf8',
);

describe('system-managed contract action guardrails wiring', () => {
  it('F050: create/update paths reject only system-managed identity mutations that should be blocked', () => {
    expect(contractActionsSource).toContain('const assertNoSystemManagedIdentityMutation =');
    expect(contractActionsSource).toContain("operation === 'create'");
    expect(contractActionsSource).toContain("'is_system_managed_default'");
    expect(contractActionsSource).toContain("'owner_client_id'");
    expect(contractActionsSource).toContain('assertNoSystemManagedIdentityMutation(contractData as Record<string, unknown>, \'create\')');
    expect(contractActionsSource).toContain('assertNoSystemManagedIdentityMutation(updateData as Record<string, unknown>, \'update\')');
    expect(contractActionsSource).toContain('const created = await Contract.create(knex, tenant, safeContractData);');
  });

  // Shared deletion guardrails are exercised in contractLifecycle.behavior.test.ts.
});
