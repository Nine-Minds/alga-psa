import { describe, expect, it } from 'vitest';
import {
  resolveChargeProfile,
  resolveChargeProfileFor,
} from '../src/lib/billing/billingProfileResolution';

/**
 * T001–T005 — the billing-profile resolution chain (F016–F023, F061, F070).
 *
 * The chain is the whole design: one deterministic, explainable, always-terminating
 * function that every generated charge passes through.
 */

const DEFAULT = 'profile-client-default';

describe('resolveChargeProfile', () => {
  // T001 — each chain step in isolation, with the source it reports.
  describe('T001: each chain step produces its own profile and source', () => {
    it('step 1 — explicit assignment on the source record', () => {
      expect(
        resolveChargeProfile({
          explicitBillingProfileId: 'profile-explicit',
          clientDefaultBillingProfileId: DEFAULT,
        }),
      ).toEqual({ billingProfileId: 'profile-explicit', source: 'explicit' });
    });

    it('step 2 — contract line', () => {
      expect(
        resolveChargeProfile({
          contractLineBillingProfileId: 'profile-line',
          clientDefaultBillingProfileId: DEFAULT,
        }),
      ).toEqual({ billingProfileId: 'profile-line', source: 'contract_line' });
    });

    it('step 3 — contract', () => {
      expect(
        resolveChargeProfile({
          contractBillingProfileId: 'profile-contract',
          clientDefaultBillingProfileId: DEFAULT,
        }),
      ).toEqual({ billingProfileId: 'profile-contract', source: 'contract' });
    });

    it('step 4 — work item', () => {
      expect(
        resolveChargeProfile({
          workItemBillingProfileId: 'profile-ticket',
          clientDefaultBillingProfileId: DEFAULT,
        }),
      ).toEqual({ billingProfileId: 'profile-ticket', source: 'work_item' });
    });

    it('step 5 — client default', () => {
      expect(
        resolveChargeProfile({ clientDefaultBillingProfileId: DEFAULT }),
      ).toEqual({ billingProfileId: DEFAULT, source: 'client_default' });
    });
  });

  // T002 — totality. A charge with no attribution at all is not a valid outcome.
  describe('T002: the chain always terminates and never returns null', () => {
    it('terminates at the client default when every upstream assignment is absent', () => {
      for (const absent of [null, undefined, '']) {
        expect(
          resolveChargeProfile({
            explicitBillingProfileId: absent,
            contractLineBillingProfileId: absent,
            contractBillingProfileId: absent,
            workItemBillingProfileId: absent,
            clientDefaultBillingProfileId: DEFAULT,
          }),
        ).toEqual({ billingProfileId: DEFAULT, source: 'client_default' });
      }
    });

    it('throws rather than returning an unattributed charge when the client default is missing', () => {
      // Unreachable while F002's database guard holds. Failing loudly beats
      // writing a charge that belongs to no segment.
      expect(() =>
        resolveChargeProfile({ clientDefaultBillingProfileId: '' }),
      ).toThrow(/default billing profile/i);
    });
  });

  // T003 — the precedence property that makes decision D4 real. This is the
  // ordering that keeps a charge off the wrong profile's invoice.
  describe('T003: contract assignments always beat the work item', () => {
    it('contract line wins over a conflicting work item', () => {
      expect(
        resolveChargeProfile({
          contractLineBillingProfileId: 'profile-line',
          workItemBillingProfileId: 'profile-ticket',
          clientDefaultBillingProfileId: DEFAULT,
        }),
      ).toEqual({ billingProfileId: 'profile-line', source: 'contract_line' });
    });

    it('contract wins over a conflicting work item', () => {
      expect(
        resolveChargeProfile({
          contractBillingProfileId: 'profile-contract',
          workItemBillingProfileId: 'profile-ticket',
          clientDefaultBillingProfileId: DEFAULT,
        }),
      ).toEqual({ billingProfileId: 'profile-contract', source: 'contract' });
    });

    it('contract line wins over the contract it belongs to', () => {
      expect(
        resolveChargeProfile({
          contractLineBillingProfileId: 'profile-line',
          contractBillingProfileId: 'profile-contract',
          clientDefaultBillingProfileId: DEFAULT,
        }),
      ).toEqual({ billingProfileId: 'profile-line', source: 'contract_line' });
    });
  });

  // T004
  it('T004: an explicit assignment wins over every other step', () => {
    expect(
      resolveChargeProfile({
        explicitBillingProfileId: 'profile-explicit',
        contractLineBillingProfileId: 'profile-line',
        contractBillingProfileId: 'profile-contract',
        workItemBillingProfileId: 'profile-ticket',
        clientDefaultBillingProfileId: DEFAULT,
      }),
    ).toEqual({ billingProfileId: 'profile-explicit', source: 'explicit' });
  });
});

// T005 — resolution depth by charge type. Depth is expressed by which inputs the
// caller can supply, not by a mode flag: usage, bucket, fixed, and recurring
// charges have no segment-bearing source record, so they simply never pass a
// work-item id and therefore stop at the contract step.
describe('T005: resolution depth by charge type', () => {
  const assignments = {
    contractLineBillingProfileId: null,
    contractBillingProfileId: 'profile-contract',
    clientDefaultBillingProfileId: DEFAULT,
  };

  it('time and manual charges can reach the work-item step', () => {
    expect(
      resolveChargeProfileFor(
        { ...assignments, contractBillingProfileId: null },
        { workItemBillingProfileId: 'profile-ticket' },
      ),
    ).toEqual({ billingProfileId: 'profile-ticket', source: 'work_item' });
  });

  it('charge types with no segment-bearing record stop at the contract step', () => {
    // usage / bucket / fixed / recurring-quantity: no per-charge input at all.
    expect(resolveChargeProfileFor(assignments)).toEqual({
      billingProfileId: 'profile-contract',
      source: 'contract',
    });
  });

  it('those types fall through to the client default when no contract assignment exists', () => {
    expect(
      resolveChargeProfileFor({
        contractLineBillingProfileId: null,
        contractBillingProfileId: null,
        clientDefaultBillingProfileId: DEFAULT,
      }),
    ).toEqual({ billingProfileId: DEFAULT, source: 'client_default' });
  });

  it('produces no attribution at all when the caller supplies no assignments (simulator path)', () => {
    // The contract simulator never persists charges, so it supplies none and
    // must not be forced to invent a profile.
    expect(resolveChargeProfileFor(null)).toBeNull();
    expect(resolveChargeProfileFor(undefined)).toBeNull();
  });
});
