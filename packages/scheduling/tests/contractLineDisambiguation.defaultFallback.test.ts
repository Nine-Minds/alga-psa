import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn(),
}));

describe('contract line disambiguation deterministic overlay precedence (scheduling)', () => {
  it('F064: explicit single-line selection remains deterministic', async () => {
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

  it('uses the single overlay line for the deterministic multi-line case', async () => {
    const { resolveDeterministicContractLineSelection } = await import('../src/lib/contractLineDisambiguation.shared');
    const deterministicFallback = resolveDeterministicContractLineSelection([
      { client_contract_line_id: 'line-explicit' } as any,
      { client_contract_line_id: 'line-overlay', bucket_overlay: { config_id: 'overlay-1' } } as any,
    ]);

    expect(deterministicFallback).toEqual({
      selectedContractLineId: 'line-overlay',
      decision: 'default',
      reason: 'bucket_overlay',
      overlayCount: 1,
      candidateCount: 2,
    });

    const ambiguousFallback = resolveDeterministicContractLineSelection([
      { client_contract_line_id: 'line-default-1', bucket_overlay: { config_id: 'overlay-1' } } as any,
      { client_contract_line_id: 'line-default-2', bucket_overlay: { config_id: 'overlay-2' } } as any,
    ]);

    expect(ambiguousFallback).toEqual({
      selectedContractLineId: null,
      decision: 'ambiguous_or_unresolved',
      reason: 'ambiguous',
      overlayCount: 2,
      candidateCount: 2,
    });
  });

  // T047 (scheduling copy) — the narrowing has to hold at time-entry create,
  // which is where a technician's entry actually gets its contract line.
  it('T047: narrows a multi-candidate field by the work item billing profile', async () => {
    const { resolveDeterministicContractLineSelection } = await import('../src/lib/contractLineDisambiguation.shared');

    expect(
      resolveDeterministicContractLineSelection(
        [
          { client_contract_line_id: 'line-a', contract_billing_profile_id: 'profile-a' } as any,
          { client_contract_line_id: 'line-b', contract_billing_profile_id: 'profile-b' } as any,
        ],
        { billingProfileId: 'profile-b' },
      ),
    ).toMatchObject({ selectedContractLineId: 'line-b', reason: 'billing_profile' });

    expect(
      resolveDeterministicContractLineSelection(
        [
          { client_contract_line_id: 'line-a', contract_billing_profile_id: 'profile-a' } as any,
          { client_contract_line_id: 'line-b', contract_billing_profile_id: 'profile-a' } as any,
        ],
        { billingProfileId: 'profile-a' },
      ),
    ).toMatchObject({ selectedContractLineId: null, reason: 'ambiguous' });
  });
});
