import { describe, it } from 'vitest';
import { expectTenantDeletion } from '../../test-utils/tenant-deletion-harness';

describe('tenant deletion prepaid block ordering', () => {
  it('deletes block dependents and blocks before their issuance, preserving other tenants', async () => {
    await expectTenantDeletion([
      ['hour_block_audit', 'hour_blocks'],
      ['hour_block_service_scopes', 'hour_blocks'],
      ['hour_block_time_allocations', 'hour_blocks'],
      ['hour_blocks', 'contract_line_block_issuances'],
      ['contract_line_block_issuances', 'tenants'],
    ]);
  });
});
