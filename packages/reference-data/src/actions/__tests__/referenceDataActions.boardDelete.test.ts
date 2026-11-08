import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const deleteEntityMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...a: unknown[]) => createTenantKnexMock(...a),
  withTransaction: vi.fn(),
  tenantDb: vi.fn(),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action({ user_id: 'u1', user_type: 'internal' }, { tenant: 't1' }, ...args),
}));
vi.mock('@alga-psa/core/server', () => ({ deleteEntityWithValidation: (...a: unknown[]) => deleteEntityMock(...a) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn() }));

describe('deleteReferenceDataItem(boards)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses to delete boards without authorization or DB access (use deleteBoard)', async () => {
    const { deleteReferenceDataItem } = await import('../referenceDataActions');
    const result = await deleteReferenceDataItem('boards', 'board-1');
    expect(result).toMatchObject({ success: false, canDelete: false, code: 'UNKNOWN_ENTITY' });
    expect(createTenantKnexMock).not.toHaveBeenCalled();
    expect(deleteEntityMock).not.toHaveBeenCalled();
  });
});
