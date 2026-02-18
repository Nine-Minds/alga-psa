import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../config/deletion', () => ({
  getDeletionConfig: vi.fn()
}));

vi.mock('./deletionValidation', () => ({
  validateDeletion: vi.fn()
}));

import { getDeletionConfig } from '../../config/deletion';
import { validateDeletion } from './deletionValidation';
import { deleteEntityWithValidation, validateBulkDeletion } from './deletionActions';

const fakeTrx = { id: 'trx' } as any;
const fakeKnex = {
  transaction: vi.fn(async (callback: (trx: any) => Promise<any>) => callback(fakeTrx))
} as any;

beforeEach(() => {
  vi.resetAllMocks();
  fakeKnex.transaction.mockImplementation(async (callback: (trx: any) => Promise<any>) => callback(fakeTrx));
  (validateDeletion as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    canDelete: true,
    dependencies: [],
    alternatives: []
  });
  (getDeletionConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    entityType: 'client',
    dependencies: []
  });
});

describe('deleteEntityWithValidation', () => {
  it('T037: validates and deletes in a single transaction', async () => {
    const performDelete = vi.fn();

    await deleteEntityWithValidation('client', 'client-1', fakeKnex, 'tenant-1', performDelete);

    expect(fakeKnex.transaction).toHaveBeenCalledTimes(1);
    expect(validateDeletion).toHaveBeenCalledWith(fakeTrx, expect.anything(), 'client-1', 'tenant-1');
    expect(performDelete).toHaveBeenCalledWith(fakeTrx, 'tenant-1');
  });

  it('T038: does not call performDelete when validation fails', async () => {
    (validateDeletion as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      canDelete: false,
      code: 'DEPENDENCIES_EXIST',
      message: 'Blocked',
      dependencies: [{ type: 'ticket', count: 1, label: 'ticket' }],
      alternatives: []
    });
    const performDelete = vi.fn();

    await deleteEntityWithValidation('client', 'client-1', fakeKnex, 'tenant-1', performDelete);

    expect(performDelete).not.toHaveBeenCalled();
  });

  it('T041: returns deleted:true on successful deletion', async () => {
    const performDelete = vi.fn();

    const result = await deleteEntityWithValidation('client', 'client-1', fakeKnex, 'tenant-1', performDelete);

    expect(result.deleted).toBe(true);
    expect(result.canDelete).toBe(true);
  });

  it('T042: returns validation result when dependencies exist in atomic check', async () => {
    (validateDeletion as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      canDelete: false,
      code: 'DEPENDENCIES_EXIST',
      message: 'Blocked',
      dependencies: [{ type: 'ticket', count: 1, label: 'ticket' }],
      alternatives: []
    });
    const performDelete = vi.fn();

    const result = await deleteEntityWithValidation('client', 'client-1', fakeKnex, 'tenant-1', performDelete);

    expect(result.canDelete).toBe(false);
    expect(result.code).toBe('DEPENDENCIES_EXIST');
  });

  it('T043: rolls back transaction when performDelete throws', async () => {
    const performDelete = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(deleteEntityWithValidation('client', 'client-1', fakeKnex, 'tenant-1', performDelete)).rejects.toThrow('fail');
  });

  it('returns UNKNOWN_ENTITY for unregistered entity type', async () => {
    (getDeletionConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const performDelete = vi.fn();

    const result = await deleteEntityWithValidation('unknown', 'id-1', fakeKnex, 'tenant-1', performDelete);

    expect(result.code).toBe('UNKNOWN_ENTITY');
    expect(result.canDelete).toBe(false);
    expect(performDelete).not.toHaveBeenCalled();
  });
});

describe('validateBulkDeletion', () => {
  it('T063: validates all entities in a single transaction', async () => {
    await validateBulkDeletion('client', ['a', 'b'], fakeKnex, 'tenant-1');

    expect(fakeKnex.transaction).toHaveBeenCalledTimes(1);
    expect(validateDeletion).toHaveBeenCalledTimes(2);
  });

  it('T064: returns canDeleteAll=true when all entities pass', async () => {
    (validateDeletion as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      canDelete: true,
      dependencies: [],
      alternatives: []
    });

    const result = await validateBulkDeletion('client', ['a'], fakeKnex, 'tenant-1');

    expect(result.canDeleteAll).toBe(true);
  });

  it('T065: returns canDeleteAll=false with cannotDelete list when some fail', async () => {
    (validateDeletion as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ canDelete: true, dependencies: [], alternatives: [] })
      .mockResolvedValueOnce({
        canDelete: false,
        code: 'DEPENDENCIES_EXIST',
        message: 'Blocked',
        dependencies: [{ type: 'ticket', count: 1, label: 'ticket' }],
        alternatives: []
      });

    const result = await validateBulkDeletion('client', ['a', 'b'], fakeKnex, 'tenant-1');

    expect(result.canDeleteAll).toBe(false);
    expect(result.cannotDelete).toHaveLength(1);
  });

  it('T066: returns error for unknown entity type', async () => {
    (getDeletionConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const result = await validateBulkDeletion('unknown', ['a'], fakeKnex, 'tenant-1');

    expect(result.code).toBe('UNKNOWN_ENTITY');
  });
});
