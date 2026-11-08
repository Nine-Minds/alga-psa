import { describe, expect, it, vi } from 'vitest';

const mockBoundary = vi.hoisted(() => ({
  loadCount: 0,
  gate: vi.fn(async () => true),
}));

vi.mock('@ee/lib/service-principals/boundary', () => {
  mockBoundary.loadCount += 1;
  return {
    servicePrincipalKeyGate: mockBoundary.gate,
  };
});

import { servicePrincipalKeyGate } from '../../../../../packages/product-service-principals/ee/entry';

describe('EE service-principal entry', () => {
  it('loads the EE implementation only when an operation is called', async () => {
    expect(mockBoundary.loadCount).toBe(0);

    await expect(servicePrincipalKeyGate({
      tenant: 'tenant-1',
      user_id: 'service-user-1',
      user_type: 'service',
    })).resolves.toBe(true);

    expect(mockBoundary.loadCount).toBe(1);
    expect(mockBoundary.gate).toHaveBeenCalledOnce();
  });
});
