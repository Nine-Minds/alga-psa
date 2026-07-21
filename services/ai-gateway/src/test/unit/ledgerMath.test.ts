import { describe, expect, it } from 'vitest';

import { checkAdmission } from '../../ledger/admission.js';
import { planMonthlyRenewal, planUsageDebit } from '../../ledger/math.js';

describe('admission checks', () => {
  it.each(['active', 'trialing', 'past_due'])('admits active-ish status %s with one credit available', (status) => {
    expect(
      checkAdmission({
        subscriptionStatus: status,
        deploymentType: 'hosted',
        includedBalance: -9n,
        topupBalance: 0n,
        graceLimitCredits: 10n,
      }),
    ).toEqual({ allowed: true, availableCredits: 1n });
  });

  it('rejects exactly at the grace floor', () => {
    expect(
      checkAdmission({
        subscriptionStatus: 'active',
        deploymentType: 'hosted',
        includedBalance: -10n,
        topupBalance: 0n,
        graceLimitCredits: 10n,
      }),
    ).toEqual({ allowed: false, reason: 'out_of_credits', availableCredits: 0n });
  });

  it('rejects a positive balance when there is no active-ish subscription', () => {
    expect(
      checkAdmission({
        subscriptionStatus: 'none',
        deploymentType: 'hosted',
        includedBalance: 100n,
        topupBalance: 0n,
        graceLimitCredits: 10n,
      }),
    ).toEqual({ allowed: false, reason: 'no_subscription', availableCredits: 110n });
  });

  it('requires active consent for appliance accounts', () => {
    const account = {
      subscriptionStatus: 'active',
      deploymentType: 'appliance' as const,
      includedBalance: 100n,
      topupBalance: 0n,
      graceLimitCredits: 0n,
    };

    expect(checkAdmission(account)).toMatchObject({
      allowed: false,
      reason: 'consent_required',
    });
    expect(checkAdmission(account, { hasActiveConsent: true })).toEqual({
      allowed: true,
      availableCredits: 100n,
    });
  });
});

describe('usage debit planning', () => {
  it('burns included credits before top-up credits and records each intermediate total', () => {
    expect(planUsageDebit(100n, 50n, 120n)).toEqual({
      includedBalance: 0n,
      topupBalance: 30n,
      movements: [
        {
          entryType: 'usage_debit',
          bucket: 'included',
          credits: -100n,
          balanceAfter: 50n,
        },
        {
          entryType: 'usage_debit',
          bucket: 'topup',
          credits: -20n,
          balanceAfter: 30n,
        },
      ],
    });
  });

  it('puts the final overshoot into the top-up bucket', () => {
    expect(planUsageDebit(5n, 2n, 10n)).toMatchObject({
      includedBalance: 0n,
      topupBalance: -3n,
    });
  });

  it('preserves an existing included deficit and burns positive top-up credits', () => {
    expect(planUsageDebit(-4n, 20n, 7n)).toEqual({
      includedBalance: -4n,
      topupBalance: 13n,
      movements: [
        {
          entryType: 'usage_debit',
          bucket: 'topup',
          credits: -7n,
          balanceAfter: 9n,
        },
      ],
    });
  });
});

describe('monthly renewal planning', () => {
  it('carries an included deficit into the new allotment and leaves top-up untouched', () => {
    expect(planMonthlyRenewal(-25n, 30n, 100n)).toEqual({
      includedBalance: 75n,
      topupBalance: 30n,
      movements: [
        {
          entryType: 'grant_included',
          bucket: 'included',
          credits: 100n,
          balanceAfter: 105n,
        },
      ],
    });
  });

  it('expires a positive included remainder before granting the next allotment', () => {
    expect(planMonthlyRenewal(25n, 30n, 100n)).toEqual({
      includedBalance: 100n,
      topupBalance: 30n,
      movements: [
        {
          entryType: 'expiry',
          bucket: 'included',
          credits: -25n,
          balanceAfter: 30n,
        },
        {
          entryType: 'grant_included',
          bucket: 'included',
          credits: 100n,
          balanceAfter: 130n,
        },
      ],
    });
  });
});
