import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
}));

describe('contract line disambiguation deterministic overlay precedence (billing)', () => {
  it('F064: returns explicit decision when a single eligible line exists', async () => {
    const { resolveDeterministicContractLineSelection } = await import('../src/lib/contractLineDisambiguation.shared');
    const resolution = resolveDeterministicContractLineSelection([
      {
        client_contract_line_id: 'line-explicit',
      } as any,
    ]);

    expect(resolution).toEqual({
      selectedContractLineId: 'line-explicit',
      decision: 'explicit',
      reason: 'single_candidate',
      overlayCount: 0,
      candidateCount: 1,
    });
  });

  it('uses the single overlay line as the deterministic selection when multiple authored lines are otherwise eligible', async () => {
    const { resolveDeterministicContractLineSelection } = await import('../src/lib/contractLineDisambiguation.shared');
    const resolution = resolveDeterministicContractLineSelection([
      {
        client_contract_line_id: 'line-explicit',
      } as any,
      {
        client_contract_line_id: 'line-overlay',
        bucket_overlay: { config_id: 'overlay-1' },
      } as any,
    ]);

    expect(resolution).toEqual({
      selectedContractLineId: 'line-overlay',
      decision: 'default',
      reason: 'bucket_overlay',
      overlayCount: 1,
      candidateCount: 2,
    });
  });

  it('keeps ambiguous multi-active scenarios unresolved when fallback is not deterministic', async () => {
    const { resolveDeterministicContractLineSelection } = await import('../src/lib/contractLineDisambiguation.shared');
    expect(
      resolveDeterministicContractLineSelection([
        { client_contract_line_id: 'line-a' } as any,
        { client_contract_line_id: 'line-b' } as any,
      ]),
    ).toEqual({
      selectedContractLineId: null,
      decision: 'ambiguous_or_unresolved',
      reason: 'ambiguous',
      overlayCount: 0,
      candidateCount: 2,
    });

    expect(
      resolveDeterministicContractLineSelection([
        { client_contract_line_id: 'line-a', bucket_overlay: { config_id: 'overlay-a' } } as any,
        { client_contract_line_id: 'line-b', bucket_overlay: { config_id: 'overlay-b' } } as any,
      ]),
    ).toEqual({
      selectedContractLineId: null,
      decision: 'ambiguous_or_unresolved',
      reason: 'ambiguous',
      overlayCount: 2,
      candidateCount: 2,
    });
  });

  // T047 — profile-aware narrowing (F133, F136). Parallel per-profile contracts
  // carrying the same service are exactly the multi-candidate case that billing
  // profiles create, so the profile has to be able to resolve it.
  describe('T047: billing-profile narrowing', () => {
    const load = async () =>
      (await import('../src/lib/contractLineDisambiguation.shared'))
        .resolveDeterministicContractLineSelection;

    it('picks the line whose own profile assignment matches', async () => {
      const resolve = await load();
      expect(
        resolve(
          [
            { client_contract_line_id: 'line-a', billing_profile_id: 'profile-a' } as any,
            { client_contract_line_id: 'line-b', billing_profile_id: 'profile-b' } as any,
          ],
          { billingProfileId: 'profile-b' },
        ),
      ).toEqual({
        selectedContractLineId: 'line-b',
        decision: 'billing_profile',
        reason: 'billing_profile',
        overlayCount: 0,
        candidateCount: 2,
      });
    });

    it('picks the line whose contract belongs to the profile', async () => {
      const resolve = await load();
      expect(
        resolve(
          [
            { client_contract_line_id: 'line-a', contract_billing_profile_id: 'profile-a' } as any,
            { client_contract_line_id: 'line-b', contract_billing_profile_id: 'profile-b' } as any,
          ],
          { billingProfileId: 'profile-a' },
        ).selectedContractLineId,
      ).toBe('line-a');
    });

    it('beats the bucket-overlay tie-break — a line on the wrong profile is wrong even with an overlay', async () => {
      const resolve = await load();
      expect(
        resolve(
          [
            { client_contract_line_id: 'line-a', billing_profile_id: 'profile-a' } as any,
            {
              client_contract_line_id: 'line-overlay',
              billing_profile_id: 'profile-b',
              bucket_overlay: { config_id: 'overlay-1' },
            } as any,
          ],
          { billingProfileId: 'profile-a' },
        ).selectedContractLineId,
      ).toBe('line-a');
    });

    it('still reports ambiguity when the profile does not narrow to one (F136)', async () => {
      const resolve = await load();
      expect(
        resolve(
          [
            { client_contract_line_id: 'line-a', billing_profile_id: 'profile-a' } as any,
            { client_contract_line_id: 'line-b', billing_profile_id: 'profile-a' } as any,
          ],
          { billingProfileId: 'profile-a' },
        ),
      ).toMatchObject({
        selectedContractLineId: null,
        decision: 'ambiguous_or_unresolved',
        reason: 'ambiguous',
      });
    });

    it('falls back to the full candidate set when no line belongs to the profile', async () => {
      const resolve = await load();
      // The profile says nothing here, so the overlay rule must still apply
      // rather than the absence of a match being read as a no-match.
      expect(
        resolve(
          [
            { client_contract_line_id: 'line-a' } as any,
            {
              client_contract_line_id: 'line-overlay',
              bucket_overlay: { config_id: 'overlay-1' },
            } as any,
          ],
          { billingProfileId: 'profile-unrelated' },
        ),
      ).toMatchObject({
        selectedContractLineId: 'line-overlay',
        reason: 'bucket_overlay',
      });
    });

    it('distinguishes no_match from ambiguous — the basis of the unresolved-item fix', async () => {
      const resolve = await load();
      expect(resolve([]).reason).toBe('no_match');
      expect(
        resolve([
          { client_contract_line_id: 'line-a' } as any,
          { client_contract_line_id: 'line-b' } as any,
        ]).reason,
      ).toBe('ambiguous');
    });
  });
});
