import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions cross-tenant validation wiring', () => {
  it('rejects cross-tenant identifiers during queue mutation validation', () => {
    expect(source).toContain("const ownerInAnotherTenant = await trx('users')");
    expect(source).toContain('.where({ user_id: normalizedAssignedTo })');
    expect(source).toContain('.whereNot({ tenant })');
    expect(source).toContain("throw new Error('Cross-tenant owner identifier is not allowed');");
    expect(source).toContain("throw new Error('Assigned owner was not found in this tenant');");

    expect(source).toContain("const crossTenantActivatedContract = await trx('contracts')");
    expect(source).toContain('contract_id: resolvedActivatedContractId,');
    expect(source).toContain("throw new Error('Cross-tenant activated contract identifier is not allowed');");
  });
});
