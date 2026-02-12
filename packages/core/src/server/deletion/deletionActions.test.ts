import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@alga-psa/auth', () => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn()
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({
  deleteEntityTags: vi.fn()
}));

vi.mock('../../config/deletion', () => ({
  getDeletionConfig: vi.fn()
}));

vi.mock('./deletionValidation', () => ({
  validateDeletion: vi.fn()
}));

import { getCurrentUser, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { deleteEntityTags } from '@alga-psa/tags/lib/tagCleanup';
import { getDeletionConfig } from '../../config/deletion';
import { validateDeletion } from './deletionValidation';
import { preCheckDeletion, deleteEntityWithValidation, validateBulkDeletion } from './deletionActions';

const user = { user_id: 'user-1' };
const fakeKnex = {} as any;
const fakeTrx = { id: 'trx' } as any;

beforeEach(() => {
  vi.resetAllMocks();
  (getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(user);
  (hasPermission as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (createTenantKnex as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ knex: fakeKnex, tenant: 'tenant-1' });
  (withTransaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_knex, callback) => callback(fakeTrx));
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

describe('preCheckDeletion', () => {
  it('T031: returns PERMISSION_DENIED when user is not authenticated', async () => {
    (getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await preCheckDeletion('client', 'client-1');

    expect(result.code).toBe('PERMISSION_DENIED');
    expect(result.canDelete).toBe(false);
  });

  it('T032: returns PERMISSION_DENIED when user lacks delete permission', async () => {
    (hasPermission as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const result = await preCheckDeletion('client', 'client-1');

    expect(result.code).toBe('PERMISSION_DENIED');
  });

  it('T033: maps client entity to company permission entity', async () => {
    await preCheckDeletion('client', 'client-1');

    expect(hasPermission).toHaveBeenCalledWith(user, 'company', 'delete');
  });

  it('T034: returns canDelete true when entity has no dependencies', async () => {
    (validateDeletion as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      canDelete: true,
      dependencies: [],
      alternatives: []
    });

    const result = await preCheckDeletion('client', 'client-1');

    expect(result.canDelete).toBe(true);
  });

  it('T035: returns dependency list when blocking deps exist', async () => {
    (validateDeletion as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      canDelete: false,
      code: 'DEPENDENCIES_EXIST',
      message: 'Blocked',
      dependencies: [{ type: 'ticket', count: 2, label: 'tickets' }],
      alternatives: []
    });

    const result = await preCheckDeletion('client', 'client-1');

    expect(result.dependencies).toHaveLength(1);
  });

  it('T036: returns error for unknown entity type', async () => {
    (getDeletionConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const result = await preCheckDeletion('unknown', 'entity-1');

    expect(result.code).toBe('UNKNOWN_ENTITY');
  });
});

describe('deleteEntityWithValidation', () => {
  it('T037: validates and deletes in a single transaction', async () => {
    const performDelete = vi.fn();

    await deleteEntityWithValidation('client', 'client-1', performDelete);

    expect(withTransaction).toHaveBeenCalledTimes(1);
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

    await deleteEntityWithValidation('client', 'client-1', performDelete);

    expect(performDelete).not.toHaveBeenCalled();
  });

  it('T039: calls deleteEntityTags before performDelete when tagEntityType is set', async () => {
    (getDeletionConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      entityType: 'client',
      tagEntityType: 'client',
      dependencies: []
    });
    const performDelete = vi.fn();

    await deleteEntityWithValidation('client', 'client-1', performDelete);

    expect(deleteEntityTags).toHaveBeenCalledWith(fakeTrx, 'client-1', 'client');
    expect(deleteEntityTags.mock.invocationCallOrder[0]).toBeLessThan(performDelete.mock.invocationCallOrder[0]);
  });

  it('T040: does not call deleteEntityTags when tagEntityType is not set', async () => {
    (getDeletionConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      entityType: 'team',
      dependencies: []
    });
    const performDelete = vi.fn();

    await deleteEntityWithValidation('team', 'team-1', performDelete);

    expect(deleteEntityTags).not.toHaveBeenCalled();
  });

  it('T041: returns deleted:true on successful deletion', async () => {
    const performDelete = vi.fn();

    const result = await deleteEntityWithValidation('client', 'client-1', performDelete);

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

    const result = await deleteEntityWithValidation('client', 'client-1', performDelete);

    expect(result.canDelete).toBe(false);
    expect(result.code).toBe('DEPENDENCIES_EXIST');
  });

  it('T043: rolls back transaction when performDelete throws', async () => {
    const performDelete = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(deleteEntityWithValidation('client', 'client-1', performDelete)).rejects.toThrow('fail');
  });
});

describe('validateBulkDeletion', () => {
  it('T063: validates all entities in a single transaction', async () => {
    await validateBulkDeletion('client', ['a', 'b']);

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(validateDeletion).toHaveBeenCalledTimes(2);
  });

  it('T064: returns canDeleteAll=true when all entities pass', async () => {
    (validateDeletion as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      canDelete: true,
      dependencies: [],
      alternatives: []
    });

    const result = await validateBulkDeletion('client', ['a']);

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

    const result = await validateBulkDeletion('client', ['a', 'b']);

    expect(result.canDeleteAll).toBe(false);
    expect(result.cannotDelete).toHaveLength(1);
  });

  it('T066: returns error for unknown entity type', async () => {
    (getDeletionConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const result = await validateBulkDeletion('unknown', ['a']);

    expect(result.code).toBe('UNKNOWN_ENTITY');
  });
});
