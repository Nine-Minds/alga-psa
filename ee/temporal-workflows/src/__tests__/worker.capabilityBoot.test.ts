import { describe, expect, it, vi } from 'vitest';

// Worker boot safety (capability gate, A6): the Temporal worker module and its
// activity/workflow registries must load when the capability gate throws on
// every call. worker.ts only runs main() when executed directly, so importing
// it exercises the full module graph without opening a Temporal connection.
const gate = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('capability gate forced to fail');
  }),
);
vi.mock('@alga-psa/core/capability', () => ({
  admits: gate,
  serves: gate,
  filterServed: gate,
  isCapabilityServed: gate,
  filterCapabilityServed: gate,
  activityServesCapability: gate,
  evaluateCapability: gate,
}));

describe('temporal worker boot with a failing capability gate', () => {
  it('loads the worker module and registries without calling the gate', async () => {
    const worker = await import('../worker.js');
    const activities = await import('../activities/index.js');
    const workflows = await import('../workflows/index.js');
    expect(worker).toBeDefined();
    expect(activities).toBeDefined();
    expect(workflows).toBeDefined();
    expect(gate).not.toHaveBeenCalled();
  });
});
