import { describe, expect, it } from 'vitest';
import { createContractSchema } from '../../../lib/api/schemas/contractLineSchemas';

describe('contract create schema ownership guardrail', () => {
  it('T018: requires owner_client_id for standalone non-template contract creation via the API path', () => {
    const missingOwnerResult = createContractSchema.safeParse({
      contract_name: 'Shared Contract',
      billing_frequency: 'monthly',
      is_active: true,
    });

    const ownedResult = createContractSchema.safeParse({
      contract_name: 'Client Contract',
      owner_client_id: '11111111-1111-4111-8111-111111111111',
      billing_frequency: 'monthly',
      is_active: true,
    });

    expect(missingOwnerResult.success).toBe(false);
    expect(ownedResult.success).toBe(true);
  });
});
