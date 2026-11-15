// Valid in every server time zone. The sibling clientContractDateColumn.timeZones.test.ts
// re-runs this file as a child process under several TZ values (vitest cannot change
// process.env.TZ after startup); EXPECT_TZ proves the zone really took effect.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({ tenantDb: () => ({}) }));

import { normalizeClientContract } from '../../../shared/billingClients/clientContracts';

describe('client_contracts DATE columns read through normalizeClientContract', () => {
  it('emits the stored calendar day for the server-local-midnight Date pg builds', () => {
    if (process.env.EXPECT_TZ) {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(process.env.EXPECT_TZ);
    }

    // pg has no DATE (1082) parser: a DATE column arrives as a Date at server-local midnight.
    const normalized = normalizeClientContract({
      contract_id: 'contract-1',
      client_contract_id: 'cc-1',
      client_id: 'client-1',
      tenant: 'tenant-1',
      start_date: new Date(2026, 3, 1),
      end_date: new Date(2026, 3, 1),
      is_active: true,
    });

    expect(normalized.start_date).toBe('2026-04-01');
    expect(normalized.end_date).toBe('2026-04-01');
  });
});
