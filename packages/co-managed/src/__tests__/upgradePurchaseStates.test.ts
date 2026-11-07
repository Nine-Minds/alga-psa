import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// The state lists are pure; the licensing/db graph the module also imports is not under test.
vi.mock('@alga-psa/licensing', () => ({ countCoManagedCommittedSeats: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn(), withTransaction: vi.fn() }));
import { CO_MANAGED_UPGRADE_PENDING_STATES, CO_MANAGED_UPGRADE_PURCHASE_STATES } from '../upgradePurchase';

const require = createRequire(import.meta.url);
const sharedStates = require('../coManagedUpgradePurchaseStates.cjs') as {
  CO_MANAGED_UPGRADE_PURCHASE_STATES: string[]; CO_MANAGED_UPGRADE_PENDING_STATES: string[];
};

describe('independent-upgrade runtime purchase states', () => {
  it('the domain exposes the shared runtime lists', () => {
    expect([...sharedStates.CO_MANAGED_UPGRADE_PURCHASE_STATES]).toEqual([...CO_MANAGED_UPGRADE_PURCHASE_STATES]);
    expect([...sharedStates.CO_MANAGED_UPGRADE_PENDING_STATES]).toEqual([...CO_MANAGED_UPGRADE_PENDING_STATES]);
  });
  it('includes payment_failed (the reference CHECK omitted it)', () => {
    expect(CO_MANAGED_UPGRADE_PURCHASE_STATES).toContain('payment_failed');
    for (const pending of CO_MANAGED_UPGRADE_PENDING_STATES) expect(CO_MANAGED_UPGRADE_PURCHASE_STATES).toContain(pending);
  });
});
