import { describe, expect, it } from 'vitest';

import {
  contractResponseSchema,
  createContractSchema,
  updateContractSchema,
} from '../../../lib/api/schemas/contractLineSchemas';

describe('contract schema system-managed default metadata', () => {
  it('F062: exposes is_system_managed_default on contract response payloads', () => {
    const parsed = contractResponseSchema.parse({
      contract_id: '11111111-1111-1111-1111-111111111111',
      contract_name: 'System-managed default contract',
      contract_description: 'Created automatically for uncontracted work',
      owner_client_id: '22222222-2222-2222-2222-222222222222',
      owner_client_name: 'Client One',
      billing_frequency: 'monthly',
      status: 'active',
      is_active: true,
      is_system_managed_default: true,
      created_at: '2026-03-21T00:00:00.000Z',
      updated_at: '2026-03-21T00:00:00.000Z',
      tenant: '33333333-3333-3333-3333-333333333333',
    });

    expect(parsed.is_system_managed_default).toBe(true);
  });

  it('keeps system-managed marker out of create/update request schemas', () => {
    const created = createContractSchema.parse({
      contract_name: 'Manual Contract',
      owner_client_id: '22222222-2222-2222-2222-222222222222',
      billing_frequency: 'monthly',
      status: 'draft',
      is_active: true,
      is_system_managed_default: true,
    } as Record<string, unknown>);

    const updated = updateContractSchema.parse({
      is_system_managed_default: true,
      contract_name: 'Updated Name',
    } as Record<string, unknown>);

    expect((created as Record<string, unknown>).is_system_managed_default).toBeUndefined();
    expect((updated as Record<string, unknown>).is_system_managed_default).toBeUndefined();
  });
});
