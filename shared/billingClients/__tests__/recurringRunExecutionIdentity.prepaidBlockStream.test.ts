/**
 * A cadence Prepaid Block line owns two streams that land in ONE invoice window:
 * the period-N arrears hourly (overage) row and the period-N+1 advance
 * prepaid_block fee row. Both share client + contract + line + window, so before
 * the stream segment their execution identity keys collided and due work kept
 * only one of them (the overage row vanished).
 */
import { describe, expect, it } from 'vitest';
import { buildRecurringDueWorkRow } from '../recurringDueWork';
import {
  buildContractCadenceDueSelectionInput,
  buildRecurringRunSelectionIdentity,
} from '../recurringRunExecutionIdentity';

const base = {
  clientId: 'client-1',
  contractId: 'contract-1',
  contractLineId: 'line-1',
  windowStart: '2026-10-01',
  windowEnd: '2026-11-01',
};

describe('contract-cadence identity key stream segment', () => {
  it('keeps the arrears hourly row and the advance prepaid_block row distinct in one window', () => {
    const arrears = buildContractCadenceDueSelectionInput(base);
    const block = buildContractCadenceDueSelectionInput({ ...base, chargeStream: 'prepaid_block' });
    expect(arrears.executionWindow.identityKey).not.toBe(block.executionWindow.identityKey);
    expect(block.executionWindow.identityKey.startsWith(arrears.executionWindow.identityKey)).toBe(true);

    const rows = [
      buildRecurringDueWorkRow({
        selectorInput: arrears, cadenceSource: 'contract_anniversary', duePosition: 'arrears',
        servicePeriodStart: '2026-09-01', servicePeriodEnd: '2026-10-01',
        clientName: 'Acme', asOf: '2026-11-02',
      } as any),
      buildRecurringDueWorkRow({
        selectorInput: block, cadenceSource: 'contract_anniversary', duePosition: 'advance',
        servicePeriodStart: '2026-10-01', servicePeriodEnd: '2026-11-01',
        clientName: 'Acme', asOf: '2026-11-02',
      } as any),
    ];
    // The Map used by candidate building keeps one row per key: both survive now.
    expect(new Map(rows.map((r) => [r.executionIdentityKey, r])).size).toBe(2);
    // Selection / retry keys (recurring-run identity) see two members.
    expect(
      buildRecurringRunSelectionIdentity(rows.map((r) => r.selectorInput.executionWindow)).executionIdentityKeys,
    ).toHaveLength(2);
  });

  it('leaves non-block contract-cadence keys exactly as before', () => {
    const key = buildContractCadenceDueSelectionInput(base).executionWindow.identityKey;
    expect(key).toBe('contract_cadence_window:contract:client-1:contract-1:line-1:2026-10-01:2026-11-01');
    expect(
      buildContractCadenceDueSelectionInput({ ...base, chargeStream: null }).executionWindow.identityKey,
    ).toBe(key);
  });
});
