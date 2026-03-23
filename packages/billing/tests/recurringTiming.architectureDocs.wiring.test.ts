import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../../../shared/billingClients/recurringTiming.ts', import.meta.url),
  'utf8'
);

describe('recurring timing architecture docs wiring', () => {
  it('documents cadence owner, service periods, invoice windows, and rollout defaults together', () => {
    expect(source).toContain('Recurring billing now treats cadence ownership as the source of truth:');
    expect(source).toContain('cadence owner chooses the service-period boundaries');
    expect(source).toContain('invoice windows group due service periods, but do not redefine them');
    expect(source).toContain('invoice detail rows persist the canonical service-period metadata used at runtime');
    expect(source).toContain('existing rows continue to resolve to `client` cadence unless they explicitly opt into a later mode');
  });
});
