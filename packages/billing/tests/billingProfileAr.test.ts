import { describe, expect, it } from 'vitest';
import {
  ageInvoicesByProfile,
  summariseClientAr,
  type ArAgeableInvoice,
} from '@alga-psa/shared/billingClients/billingProfileAr';

/**
 * T040/T041 — AR per billing profile, and the property that the parts sum to
 * the whole.
 *
 * The failure this guards against is subtle: a per-profile breakdown that
 * quietly drops invoices predating profiles, or credit filed against no
 * profile, produces a page where the rows and the total disagree. A collector
 * looking at it has no way to tell which number is wrong, so both become
 * unusable.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 31);

const DEFAULT_PROFILE = 'profile-default';
const SITE_PROFILE = 'profile-site';

const PROFILES = [
  { billing_profile_id: DEFAULT_PROFILE, name: 'Head Office', is_default: true },
  { billing_profile_id: SITE_PROFILE, name: 'Site B', is_default: false },
];

const invoice = (
  billing_profile_id: string | null,
  total: number,
  daysPastDue: number | null,
  paid = 0,
): ArAgeableInvoice => ({
  billing_profile_id,
  due_date: daysPastDue === null ? null : new Date(NOW - daysPastDue * DAY).toISOString(),
  total_amount: total,
  credit_applied: 0,
  paid_amount: paid,
});

describe('T040: aging is bucketed per billing profile', () => {
  it('puts each invoice in one bucket of the profile that billed it', () => {
    const aged = ageInvoicesByProfile(
      [
        invoice(DEFAULT_PROFILE, 1000, -5), // not yet due
        invoice(DEFAULT_PROFILE, 2000, 10),
        invoice(SITE_PROFILE, 3000, 45),
        invoice(SITE_PROFILE, 4000, 200),
      ],
      NOW,
    );

    expect(aged.byProfile.get(DEFAULT_PROFILE)!.aging).toEqual({
      currentCents: 1000,
      d30Cents: 2000,
      d60Cents: 0,
      d90PlusCents: 0,
    });
    expect(aged.byProfile.get(SITE_PROFILE)!.aging).toEqual({
      currentCents: 0,
      d30Cents: 0,
      d60Cents: 3000,
      d90PlusCents: 4000,
    });
  });

  it('ignores invoices with nothing left outstanding', () => {
    // Fully paid and fully credited invoices are not receivable, and counting
    // them would age money nobody owes.
    const aged = ageInvoicesByProfile([invoice(SITE_PROFILE, 5000, 90, 5000)], NOW);
    expect(aged.byProfile.size).toBe(0);
  });

  it('treats an invoice with no due date as current', () => {
    const aged = ageInvoicesByProfile([invoice(DEFAULT_PROFILE, 700, null)], NOW);
    expect(aged.byProfile.get(DEFAULT_PROFILE)!.aging.currentCents).toBe(700);
  });
});

describe('T041: the client total is the sum of its profiles', () => {
  it('sums rows to the client figure, credits included', () => {
    const summary = summariseClientAr({
      profiles: PROFILES,
      aged: ageInvoicesByProfile(
        [invoice(DEFAULT_PROFILE, 2000, 10), invoice(SITE_PROFILE, 3000, 45)],
        NOW,
      ),
      creditByProfile: new Map([
        [DEFAULT_PROFILE, 500],
        [SITE_PROFILE, 250],
      ]),
    });

    expect(summary.isSegmented).toBe(true);
    expect(summary.outstandingTotalCents).toBe(5000);
    expect(summary.availableCreditCents).toBe(750);
    expect(summary.aging).toEqual({
      currentCents: 0,
      d30Cents: 2000,
      d60Cents: 3000,
      d90PlusCents: 0,
    });

    const summed = summary.rows.reduce((total, row) => total + row.outstandingTotalCents, 0);
    expect(summed).toBe(summary.outstandingTotalCents);
  });

  it('folds pre-profile invoices into the default profile rather than losing them', () => {
    // An invoice raised before this feature existed carries no profile. It was
    // billed to the client as a whole, which is what the default profile is —
    // dropping it would make the rows stop summing to the total.
    const summary = summariseClientAr({
      profiles: PROFILES,
      aged: ageInvoicesByProfile([invoice(null, 900, 5), invoice(SITE_PROFILE, 100, 5)], NOW),
      creditByProfile: new Map(),
      unattributedCreditCents: 40,
    });

    const defaultRow = summary.rows.find((row) => row.isDefault)!;
    expect(defaultRow.outstandingTotalCents).toBe(900);
    expect(defaultRow.availableCreditCents).toBe(40);
    expect(summary.outstandingTotalCents).toBe(1000);
    expect(
      summary.rows.reduce((total, row) => total + row.outstandingTotalCents, 0),
    ).toBe(summary.outstandingTotalCents);
  });

  it('an unsegmented client reports one row equal to its totals', () => {
    // The pre-profile client sees the number it has always seen, and
    // `isSegmented` stays false so no profile surface appears at all (D6).
    const summary = summariseClientAr({
      profiles: [PROFILES[0]],
      aged: ageInvoicesByProfile([invoice(DEFAULT_PROFILE, 1234, 40)], NOW),
      creditByProfile: new Map([[DEFAULT_PROFILE, 99]]),
    });

    expect(summary.isSegmented).toBe(false);
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].outstandingTotalCents).toBe(summary.outstandingTotalCents);
    expect(summary.rows[0].aging).toEqual(summary.aging);
    expect(summary.rows[0].availableCreditCents).toBe(summary.availableCreditCents);
  });
});
