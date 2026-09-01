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

  it('accepts and preserves client_id with start_date and end_date', () => {
    const result = createContractSchema.safeParse({
      client_id: '11111111-1111-4111-8111-111111111111',
      contract_name: 'Client Contract',
      billing_frequency: 'monthly',
      start_date: '2026-08-01T00:00:00.000Z',
      end_date: '2027-07-31T23:59:59.999Z',
      is_active: true,
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      client_id: '11111111-1111-4111-8111-111111111111',
      start_date: '2026-08-01T00:00:00.000Z',
      end_date: '2027-07-31T23:59:59.999Z',
    });
  });

  it('rejects unsupported extraneous fields instead of silently stripping them', () => {
    const result = createContractSchema.safeParse({
      client_id: '11111111-1111-4111-8111-111111111111',
      contract_name: 'Client Contract',
      billing_frequency: 'monthly',
      bogus_field: 'should be rejected',
    });

    expect(result.success).toBe(false);
  });
});
