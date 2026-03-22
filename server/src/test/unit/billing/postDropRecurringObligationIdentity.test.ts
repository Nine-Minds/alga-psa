import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildClientCadencePostDropObligationRef,
  buildPersistedClientCadencePostDropObligationRef,
  buildPostDropRecurringObligationCandidates,
  CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE,
} from '@alga-psa/shared/billingClients/postDropRecurringObligationIdentity';

describe('post-drop recurring obligation identity', () => {
  it('builds client-cadence compatibility refs on the surviving contract_line_id', () => {
    expect(
      buildClientCadencePostDropObligationRef({
        contractLineId: 'line-1',
        chargeFamily: 'fixed',
        tenant: 'tenant-1',
      }),
    ).toEqual({
      tenant: 'tenant-1',
      obligationId: 'line-1',
      obligationType: CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE,
      chargeFamily: 'fixed',
    });

    expect(
      buildPersistedClientCadencePostDropObligationRef({
        tenant: 'tenant-1',
        contractLineId: 'line-1',
        chargeFamily: 'bucket',
      }),
    ).toEqual({
      tenant: 'tenant-1',
      obligationId: 'line-1',
      obligationType: CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE,
      chargeFamily: 'bucket',
    });
  });

  it('keeps post-drop obligation candidate matching on one canonical id', () => {
    expect(
      buildPostDropRecurringObligationCandidates({
        contractLineId: 'line-1',
        chargeFamily: 'fixed',
      }),
    ).toEqual([
      {
        obligationId: 'line-1',
        obligationType: 'contract_line',
        chargeFamily: 'fixed',
      },
      {
        obligationId: 'line-1',
        obligationType: CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE,
        chargeFamily: 'fixed',
      },
    ]);
  });

  it('wires recurring runtime callers through the shared post-drop helper instead of inline identity shims', () => {
    const root = process.cwd();
    const files = [
      '../packages/billing/src/actions/billingAndTax.ts',
      '../packages/billing/src/actions/clientCadenceScheduleRegeneration.ts',
      '../packages/billing/src/actions/invoiceGeneration.ts',
      '../packages/billing/src/actions/recurringServicePeriodActions.ts',
      '../packages/billing/src/services/invoiceService.ts',
      '../packages/billing/src/services/bucketUsageService.ts',
      '../packages/billing/src/lib/billing/billingEngine.ts',
    ].map((relativePath) => readFileSync(path.resolve(root, relativePath), 'utf8'));

    for (const source of files) {
      expect(source).not.toContain("obligationType: 'client_contract_line'");
      expect(source).not.toContain('obligationType: "client_contract_line"');
      expect(source).not.toContain("obligation_type: 'client_contract_line'");
      expect(source).not.toContain('obligation_type: "client_contract_line"');
    }

    expect(files.some((source) => source.includes('buildClientCadencePostDropObligationRef'))).toBe(true);
    expect(files.some((source) => source.includes('CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE'))).toBe(true);
    expect(files.some((source) => source.includes('POST_DROP_RECURRING_OBLIGATION_TYPES'))).toBe(true);
  });
});
