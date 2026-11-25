import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGatewayMessage, mockDkimResolver } from '../../../lib/email/__tests__/gatewayFixtures';

const firstMock = vi.fn();
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: () => ({ where: () => ({ first: firstMock }) }) }),
}));

describe('resolveInboundAuthTrust', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mode off / no row: no DNS lookups and cv=none', async () => {
    const resolver = vi.fn(mockDkimResolver());
    const { resolveInboundAuthTrust } = await import('../inboundAuthTrust');
    const { rawMime } = await buildGatewayMessage();
    for (const row of [undefined, { inbound_auth_trust: { mode: 'off' } }, { inbound_auth_trust: { mode: 'mta-arc-pass', trustedAuthservIds: ['mx.avanan.net'] } }]) {
      firstMock.mockResolvedValueOnce(row);
      const result = await resolveInboundAuthTrust({ tenantId: 't', providerId: 'p', rawMime, resolver, db: {} as any });
      expect(result.arcSeal.cv).toBe('none');
    }
    expect(resolver).not.toHaveBeenCalled();
  });

  it('arc-sealed: verifies the seal from raw bytes (base64 too)', async () => {
    firstMock.mockResolvedValue({ inbound_auth_trust: { mode: 'arc-sealed', trustedAuthservIds: ['MX.Avanan.net'] } });
    const { resolveInboundAuthTrust } = await import('../inboundAuthTrust');
    const { rawMime } = await buildGatewayMessage();
    const result = await resolveInboundAuthTrust({
      tenantId: 't', providerId: 'p', rawMimeBase64: rawMime.toString('base64'), resolver: mockDkimResolver(), db: {} as any,
    });
    expect(result.policy).toEqual({ mode: 'arc-sealed', trustedAuthservIds: ['mx.avanan.net'] });
    expect(result.arcSeal).toEqual({ cv: 'pass', sealingAuthservId: 'mx.avanan.net' });
  });

  it('arc-sealed without raw bytes: cv=none (not trusted)', async () => {
    firstMock.mockResolvedValue({ inbound_auth_trust: { mode: 'arc-sealed', trustedAuthservIds: ['mx.avanan.net'] } });
    const { resolveInboundAuthTrust } = await import('../inboundAuthTrust');
    const result = await resolveInboundAuthTrust({ tenantId: 't', providerId: 'p', db: {} as any });
    expect(result.arcSeal.cv).toBe('none');
  });

  it('a policy lookup failure degrades to off', async () => {
    firstMock.mockRejectedValue(new Error('db down'));
    const { loadInboundAuthTrustPolicy } = await import('../inboundAuthTrust');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadInboundAuthTrustPolicy('t', 'p', {} as any)).toEqual({ mode: 'off', trustedAuthservIds: [] });
    warn.mockRestore();
  });
});
