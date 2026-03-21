import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
}));

describe('contract line disambiguation default fallback precedence (billing)', () => {
  it('F064: returns explicit decision when a single eligible line exists', async () => {
    const { resolveDeterministicContractLineSelection } = await import('../src/lib/contractLineDisambiguation');
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

  it('uses system-managed default only as fallback when exactly one overlay line exists among multiple eligibles', async () => {
    const { resolveDeterministicContractLineSelection } = await import('../src/lib/contractLineDisambiguation');
    const resolution = resolveDeterministicContractLineSelection([
      {
        client_contract_line_id: 'line-explicit',
      } as any,
      {
        client_contract_line_id: 'line-default',
        bucket_overlay: { config_id: 'overlay-1' },
      } as any,
    ]);

    expect(resolution).toEqual({
      selectedContractLineId: 'line-default',
      decision: 'default',
      overlayCount: 1,
    });
  });

  it('keeps ambiguous multi-active scenarios unresolved when fallback is not deterministic', async () => {
    const { resolveDeterministicContractLineSelection } = await import('../src/lib/contractLineDisambiguation');
    expect(
      resolveDeterministicContractLineSelection([
        { client_contract_line_id: 'line-a' } as any,
        { client_contract_line_id: 'line-b' } as any,
      ]),
    ).toEqual({
      selectedContractLineId: null,
      decision: 'ambiguous_or_unresolved',
      overlayCount: 0,
    });

    expect(
      resolveDeterministicContractLineSelection([
        { client_contract_line_id: 'line-a', bucket_overlay: { config_id: 'overlay-a' } } as any,
        { client_contract_line_id: 'line-b', bucket_overlay: { config_id: 'overlay-b' } } as any,
      ]),
    ).toEqual({
      selectedContractLineId: null,
      decision: 'ambiguous_or_unresolved',
      overlayCount: 2,
    });
  });
});
