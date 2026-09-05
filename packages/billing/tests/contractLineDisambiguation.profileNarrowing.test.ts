import { describe, expect, it } from 'vitest';
import { resolveDeterministicContractLineSelection } from '../src/lib/contractLineDisambiguation.shared';
import { resolveDeterministicContractLineSelection as schedulingResolve } from '../../scheduling/src/lib/contractLineDisambiguation.shared';

/**
 * T048 — parallel per-profile contracts carrying the same service.
 *
 * This is the case the whole feature generates. A client with two separately
 * billed entities routinely holds one contract per entity, each covering the
 * same service. Before profiles, "two eligible lines for this service" was rare
 * and unresolved was the honest answer; after profiles it is the *normal* shape,
 * and leaving it unresolved would give exactly the customers this feature
 * targets worse billing accuracy than they had before it shipped (F133–F136).
 *
 * The narrowing is therefore not a refinement — it is the thing that makes the
 * feature safe to ship. The other half of the guarantee matters just as much:
 * when narrowing cannot decide, it reports ambiguity instead of picking.
 */

const SITE_A = 'profile-site-a';
const SITE_B = 'profile-site-b';

const line = (
  client_contract_line_id: string,
  overrides: {
    billing_profile_id?: string | null;
    contract_billing_profile_id?: string | null;
    overlay?: boolean;
  } = {},
) => ({
  client_contract_line_id,
  billing_profile_id: overrides.billing_profile_id ?? null,
  contract_billing_profile_id: overrides.contract_billing_profile_id ?? null,
  bucket_overlay: overrides.overlay ? { config_id: `overlay-${client_contract_line_id}` } : null,
});

describe('T048: parallel per-profile contracts resolve by the work item’s profile', () => {
  it('picks the line whose contract belongs to the work item’s profile', () => {
    const result = resolveDeterministicContractLineSelection(
      [
        line('line-a', { contract_billing_profile_id: SITE_A }),
        line('line-b', { contract_billing_profile_id: SITE_B }),
      ],
      { billingProfileId: SITE_B },
    );

    expect(result.selectedContractLineId).toBe('line-b');
    expect(result.decision).toBe('billing_profile');
    expect(result.reason).toBe('billing_profile');
    // The count reported is the field it started from, not the narrowed one —
    // a reviewer needs to see that a choice was actually made.
    expect(result.candidateCount).toBe(2);
  });

  it('accepts the assignment from the line as readily as from its contract', () => {
    // Step 2 of the chain (contract line) and step 3 (contract) are different
    // assignments, but either one identifies the entity that owns the line.
    const result = resolveDeterministicContractLineSelection(
      [line('line-a', { billing_profile_id: SITE_A }), line('line-b', { billing_profile_id: SITE_B })],
      { billingProfileId: SITE_A },
    );
    expect(result.selectedContractLineId).toBe('line-a');
  });

  it('beats the bucket-overlay tie-break', () => {
    // A line on the wrong entity is wrong even when it is the only one with an
    // overlay. Deciding by overlay first would bill Site A's work to Site B
    // whenever Site B happened to hold the bucket.
    const result = resolveDeterministicContractLineSelection(
      [
        line('line-a', { contract_billing_profile_id: SITE_A }),
        line('line-b', { contract_billing_profile_id: SITE_B, overlay: true }),
      ],
      { billingProfileId: SITE_A },
    );
    expect(result.selectedContractLineId).toBe('line-a');
    expect(result.reason).toBe('billing_profile');
  });

  it('reports ambiguity rather than picking when the profile cannot decide', () => {
    // Two lines on the *same* profile is a genuine ambiguity that profiles do
    // not resolve. Picking either one would be a silent guess about which
    // contract prices the work (F136).
    const result = resolveDeterministicContractLineSelection(
      [
        line('line-a', { contract_billing_profile_id: SITE_A }),
        line('line-b', { contract_billing_profile_id: SITE_A }),
      ],
      { billingProfileId: SITE_A },
    );
    expect(result.selectedContractLineId).toBeNull();
    expect(result.reason).toBe('ambiguous');
  });

  it('falls back to the full field when the profile matches nothing', () => {
    // Zero matches means the profile says nothing about these lines — not that
    // there is no match. Reporting `no_match` here would tell the biller that
    // no contract covers the service, and catalog pricing would look honest
    // when it is exactly wrong (the D10 distinction).
    const result = resolveDeterministicContractLineSelection(
      [line('line-a', { overlay: true }), line('line-b')],
      { billingProfileId: SITE_B },
    );
    expect(result.selectedContractLineId).toBe('line-a');
    expect(result.reason).toBe('bucket_overlay');
  });

  it('leaves the single-candidate and no-candidate answers untouched', () => {
    // The unsegmented client's two outcomes, unchanged. Everything above is
    // reachable only when more than one line is eligible.
    expect(
      resolveDeterministicContractLineSelection([line('line-only')], { billingProfileId: SITE_A }),
    ).toMatchObject({ selectedContractLineId: 'line-only', reason: 'single_candidate' });
    expect(
      resolveDeterministicContractLineSelection([], { billingProfileId: SITE_A }),
    ).toMatchObject({ selectedContractLineId: null, reason: 'no_match' });
  });
});

describe('T048: the scheduling copy of the rule answers identically', () => {
  it('agrees with the billing copy on every case above', () => {
    // LEVERAGE: pattern contract-line-disambiguation-copy — the rule is
    // duplicated to avoid a scheduling → billing dependency, so time entries
    // created in the UI and charges reconciled at generation could silently
    // diverge. Until the shared layer exists, this asserts they do not.
    const cases: Array<[Parameters<typeof resolveDeterministicContractLineSelection>[0], string | null]> = [
      [[line('a', { contract_billing_profile_id: SITE_A }), line('b', { contract_billing_profile_id: SITE_B })], SITE_B],
      [[line('a', { contract_billing_profile_id: SITE_A }), line('b', { contract_billing_profile_id: SITE_A })], SITE_A],
      [[line('a', { overlay: true }), line('b')], SITE_B],
      [[line('a')], null],
      [[], SITE_A],
    ];

    for (const [lines, profileId] of cases) {
      expect(schedulingResolve(lines as any, { billingProfileId: profileId })).toEqual(
        resolveDeterministicContractLineSelection(lines as any, { billingProfileId: profileId }),
      );
    }
  });
});
