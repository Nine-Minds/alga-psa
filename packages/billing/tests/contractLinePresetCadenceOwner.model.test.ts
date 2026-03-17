import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('contract line preset cadence_owner model behavior', () => {
  let existingPreset: any;
  let insertedPayload: any;
  let updatedPayload: any;

  const makePresetQuery = () => {
    const query: any = {};

    query.where = vi.fn(() => query);
    query.first = vi.fn(async () => existingPreset);
    query.select = vi.fn(async () => (existingPreset ? [existingPreset] : []));
    query.insert = vi.fn((payload: any) => {
      insertedPayload = payload;
      return {
        returning: async () => [payload],
      };
    });
    query.update = vi.fn((payload: any) => {
      updatedPayload = payload;
      return {
        returning: async () => [
          {
            ...(existingPreset ?? {}),
            ...payload,
          },
        ],
      };
    });

    return query;
  };

  beforeEach(() => {
    existingPreset = null;
    insertedPayload = null;
    updatedPayload = null;
  });

  it('defaults cadence_owner to client on create and preserves stored cadence_owner on update when omitted', async () => {
    const { default: ContractLinePreset } = await import('../src/models/contractLinePreset');

    const query = makePresetQuery();
    const trx: any = vi.fn((table: string) => {
      if (table !== 'contract_line_presets') {
        throw new Error(`Unexpected table: ${table}`);
      }
      return query;
    });

    const created = await ContractLinePreset.create(trx, 'tenant-1', {
      preset_name: 'Managed Services',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
      billing_timing: 'advance',
    });

    expect(insertedPayload).toMatchObject({
      tenant: 'tenant-1',
      cadence_owner: 'client',
    });
    expect(created.cadence_owner).toBe('client');

    existingPreset = {
      preset_id: 'preset-1',
      tenant: 'tenant-1',
      preset_name: 'Managed Services',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
      billing_timing: 'advance',
      cadence_owner: 'contract',
    };

    const updated = await ContractLinePreset.update(trx, 'tenant-1', 'preset-1', {
      preset_name: 'Managed Services Updated',
    });

    expect(updatedPayload).toMatchObject({
      preset_name: 'Managed Services Updated',
      cadence_owner: 'contract',
    });
    expect(updated.cadence_owner).toBe('contract');
  });
});
