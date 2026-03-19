import { describe, expect, it } from 'vitest';
import {
  createContractLineSchema,
  updateContractLineSchema,
  contractLineResponseSchema,
} from 'server/src/lib/api/schemas/contractLineSchemas';
import {
  createContractLineSchema as createFinancialContractLineSchema,
  createClientContractLineSchema,
  updateClientContractLineSchema,
} from 'server/src/lib/api/schemas/financialSchemas';

describe('contract line cadence owner API schemas', () => {
  it('T105 and T144: server API schemas accept contract cadence writes while still rejecting invalid cadence-owner values', () => {
    const allowedCreate = createContractLineSchema.safeParse({
      contract_line_name: 'Managed Support',
      billing_frequency: 'monthly',
      contract_line_type: 'Fixed',
      cadence_owner: 'contract',
    });

    const validFinancialCreate = createFinancialContractLineSchema.safeParse({
      tenant: '11111111-1111-4111-8111-111111111111',
      contract_line_name: 'Managed Support',
      billing_frequency: 'monthly',
      contract_line_type: 'Fixed',
      cadence_owner: 'client',
    });

    const validClientLine = createClientContractLineSchema.safeParse({
      tenant: '11111111-1111-4111-8111-111111111111',
      client_id: '22222222-2222-4222-8222-222222222222',
      contract_line_id: '33333333-3333-4333-8333-333333333333',
      start_date: '2026-03-17T00:00:00.000Z',
      cadence_owner: 'client',
    });

    const allowedClientLine = createClientContractLineSchema.safeParse({
      tenant: '11111111-1111-4111-8111-111111111111',
      client_id: '22222222-2222-4222-8222-222222222222',
      contract_line_id: '33333333-3333-4333-8333-333333333333',
      start_date: '2026-03-17T00:00:00.000Z',
      cadence_owner: 'contract',
    });

    const allowedClientLineUpdate = updateClientContractLineSchema.safeParse({
      cadence_owner: 'contract',
    });

    const validResponse = contractLineResponseSchema.safeParse({
      contract_line_id: '44444444-4444-4444-8444-444444444444',
      contract_line_name: 'Managed Support',
      billing_frequency: 'monthly',
      is_custom: false,
      service_category: null,
      contract_line_type: 'Fixed',
      cadence_owner: 'contract',
      hourly_rate: null,
      minimum_billable_time: null,
      round_up_to_nearest: null,
      enable_overtime: null,
      overtime_rate: null,
      overtime_threshold: null,
      enable_after_hours_rate: null,
      after_hours_multiplier: null,
      created_at: '2026-03-17T00:00:00.000Z',
      updated_at: '2026-03-17T00:00:00.000Z',
      tenant: '55555555-5555-4555-8555-555555555555',
    });

    const invalidCreate = createContractLineSchema.safeParse({
      contract_line_name: 'Managed Support',
      billing_frequency: 'monthly',
      contract_line_type: 'Fixed',
      cadence_owner: 'billing-cycle',
    });

    const invalidUpdate = updateContractLineSchema.safeParse({
      cadence_owner: 'anniversary',
    });

    expect(allowedCreate.success).toBe(true);
    expect(validFinancialCreate.success).toBe(true);
    expect(validClientLine.success).toBe(true);
    expect(allowedClientLine.success).toBe(true);
    expect(allowedClientLineUpdate.success).toBe(true);
    expect(validResponse.success).toBe(true);
    expect(invalidCreate.success).toBe(false);
    expect(invalidUpdate.success).toBe(false);
  });
});
