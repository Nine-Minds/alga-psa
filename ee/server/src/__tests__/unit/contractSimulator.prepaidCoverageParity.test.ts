/**
 * The engine (DatabaseChargeSource, real allocation rows) and the simulator
 * (ScenarioChargeSource, ledger share) feed the same resolver rule,
 * applyPrepaidCoverage. The same logical draw must give the same decision:
 * an active-block draw is subtracted from the entry, a pending-block draw
 * holds the entry. No database access.
 */

import { describe, expect, it } from 'vitest';
import { DatabaseChargeSource } from '@alga-psa/billing/lib/billing/chargeResolution';
import { applyPrepaidCoverage } from '@alga-psa/billing/lib/billing/chargeResolution/prepaidBlockRules';
import type { PrepaidCoverageRow } from '@alga-psa/billing/lib/billing/chargeResolution';
import { ScenarioChargeSource } from '@ee/lib/billing/simulator/scenarioChargeSource';

const timing = { servicePeriodStart: '2026-11-01', servicePeriodEnd: '2026-11-30' } as any;

function scenarioSource(share: number) {
  const line = {
    key: 'line-1',
    billing_frequency: 'monthly',
    enable_overtime: false,
    services: [
      {
        service_id: 'svc-h',
        service_name: 'Support',
        item_kind: 'service',
        default_rate: 10000,
        configuration: { configuration_type: 'Hourly', hourly_rate: 10000, user_type_rates: [] },
      },
    ],
  } as any;
  return new ScenarioChargeSource({
    scenario: { assumptions: { 'line-1:svc-h': { flat: 10, overrides: {} } } } as any,
    line,
    lineFacts: {} as any,
    client: { client_id: 'c' },
    billingPeriod: { startDate: '2026-11-01', endDate: '2026-12-01' } as any,
    timings: {},
    periodIndex: 1,
    taxPorts: {} as any,
    currencyCode: 'USD',
    lineCycle: 'monthly',
    diagnostics: [],
    run: { poolStates: new Map(), prepaidLedgers: new Map([['line-1', { demandCoverage: new Map([[1, share]]) } as any]]) },
  });
}

function databaseSource(rows: PrepaidCoverageRow[]) {
  return new DatabaseChargeSource({ tenant: 't' } as any, {
    clientContractLine: {} as any,
    loaders: { prepaidCoverage: async () => rows },
  } as any);
}

describe('prepaid coverage: engine and simulator share one decision', () => {
  it('subtracts an active-block draw identically', async () => {
    const sim = scenarioSource(0.4);
    const charge = await sim.hourly(timing, null);
    const entry = charge!.facts.activity[0];
    expect(entry.billableMinutes).toBe(600);
    const simRows = await sim.prepaidCoverage([entry.sourceId]);
    expect(simRows).toEqual([{ entryId: entry.sourceId, blockStatus: 'active', minutes: 240 }]);

    const engineRows = await databaseSource([
      { entryId: entry.sourceId, blockStatus: 'active', minutes: 240 },
    ]).prepaidCoverage([entry.sourceId]);

    const [simLeft] = applyPrepaidCoverage([entry], simRows);
    const [engineLeft] = applyPrepaidCoverage([entry], engineRows);
    expect(simLeft.billableMinutes).toBe(360);
    expect(engineLeft.billableMinutes).toBe(simLeft.billableMinutes);
  });

  it('drops a fully covered entry in both', async () => {
    const sim = scenarioSource(1);
    const entry = (await sim.hourly(timing, null))!.facts.activity[0];
    const simRows = await sim.prepaidCoverage([entry.sourceId]);
    const engineRows = [{ entryId: entry.sourceId, blockStatus: 'expired', minutes: 600 }];
    expect(applyPrepaidCoverage([entry], simRows)).toEqual([]);
    expect(applyPrepaidCoverage([entry], engineRows)).toEqual([]);
  });

  it('holds an entry drawn by a pending block (engine rows) and leaves undrawn entries alone', async () => {
    const sim = scenarioSource(0);
    const entry = (await sim.hourly(timing, null))!.facts.activity[0];
    expect(await sim.prepaidCoverage([entry.sourceId])).toEqual([]);
    const pending = [{ entryId: entry.sourceId, blockStatus: 'pending', minutes: 30 }];
    expect(applyPrepaidCoverage([entry], pending)).toEqual([]);
    expect(applyPrepaidCoverage([entry], [])).toEqual([entry]);
    // Void blocks neither cover nor hold.
    expect(
      applyPrepaidCoverage([entry], [{ entryId: entry.sourceId, blockStatus: 'void', minutes: 30 }]),
    ).toEqual([entry]);
  });
});
