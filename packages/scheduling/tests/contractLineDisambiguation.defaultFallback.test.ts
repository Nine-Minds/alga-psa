import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn(),
}));

describe('contract line disambiguation default fallback precedence (scheduling)', () => {
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
      overlayCount: 0,
    });
  });

  it('uses default fallback only for the deterministic single-overlay case', async () => {
    const { resolveDeterministicContractLineSelection } = await import('../src/lib/contractLineDisambiguation.shared');
    const deterministicFallback = resolveDeterministicContractLineSelection([
      { client_contract_line_id: 'line-explicit' } as any,
      { client_contract_line_id: 'line-default', bucket_overlay: { config_id: 'overlay-1' } } as any,
    ]);

    expect(deterministicFallback).toEqual({
      selectedContractLineId: 'line-default',
      decision: 'default',
      overlayCount: 1,
    });

    const ambiguousFallback = resolveDeterministicContractLineSelection([
      { client_contract_line_id: 'line-default-1', bucket_overlay: { config_id: 'overlay-1' } } as any,
      { client_contract_line_id: 'line-default-2', bucket_overlay: { config_id: 'overlay-2' } } as any,
    ]);

    expect(ambiguousFallback).toEqual({
      selectedContractLineId: null,
      decision: 'ambiguous_or_unresolved',
      overlayCount: 2,
    });
  });
});
