import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { validateDeletion } from './deletionValidation';
import type { EntityDeletionConfig, EntityDependencyConfig } from '@alga-psa/types';

function makeTrx(count: number) {
  const builder = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    count: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({ count: String(count) })
  };
  const trx = vi.fn().mockReturnValue(builder) as unknown as Knex;
  return { trx, builder };
}

describe('validateDeletion', () => {
  it('T006: returns canDelete:true when entity has no dependencies', async () => {
    const { trx } = makeTrx(0);
    const config: EntityDeletionConfig = {
      entityType: 'ticket',
      dependencies: [
        { type: 'project', table: 'projects', foreignKey: 'ticket_id', label: 'project' }
      ]
    };

    const result = await validateDeletion(trx, config, 'ticket-1', 'tenant-1');

    expect(result.canDelete).toBe(true);
    expect(result.dependencies).toEqual([]);
  });

  it('T007: returns canDelete:false with dependency list when blocking deps exist', async () => {
    const { trx } = makeTrx(2);
    const config: EntityDeletionConfig = {
      entityType: 'ticket',
      dependencies: [
        { type: 'project', table: 'projects', foreignKey: 'ticket_id', label: 'project' }
      ]
    };

    const result = await validateDeletion(trx, config, 'ticket-1', 'tenant-1');

    expect(result.canDelete).toBe(false);
    expect(result.dependencies).toHaveLength(1);
  });

  it('T008: counts dependencies using foreignKey from config', async () => {
    const { trx, builder } = makeTrx(1);
    const config: EntityDeletionConfig = {
      entityType: 'ticket',
      dependencies: [
        { type: 'project', table: 'projects', foreignKey: 'ticket_id', label: 'project' }
      ]
    };

    await validateDeletion(trx, config, 'ticket-123', 'tenant-1');

    expect(builder.where).toHaveBeenCalledWith({ tenant: 'tenant-1' });
    expect(builder.andWhere).toHaveBeenCalledWith('ticket_id', 'ticket-123');
  });

  it('T009: uses custom countQuery when provided', async () => {
    const countQuery = vi.fn().mockResolvedValue(3);
    const config: EntityDeletionConfig = {
      entityType: 'document',
      dependencies: [
        { type: 'document', table: 'document_associations', label: 'document', countQuery }
      ]
    };

    const result = await validateDeletion({} as Knex, config, 'doc-1', 'tenant-1');

    expect(countQuery).toHaveBeenCalledWith({}, { tenant: 'tenant-1', entityId: 'doc-1' });
    expect(result.dependencies[0].count).toBe(3);
  });

  it('T010: formats singular labels correctly', async () => {
    const { trx } = makeTrx(1);
    const config: EntityDeletionConfig = {
      entityType: 'ticket',
      dependencies: [
        { type: 'ticket', table: 'tickets', foreignKey: 'category_id', label: 'ticket' }
      ]
    };

    const result = await validateDeletion(trx, config, 'cat-1', 'tenant-1');

    expect(result.dependencies[0].label).toBe('ticket');
  });

  it('T011: formats plural labels correctly', async () => {
    const { trx } = makeTrx(5);
    const config: EntityDeletionConfig = {
      entityType: 'ticket',
      dependencies: [
        { type: 'ticket', table: 'tickets', foreignKey: 'category_id', label: 'ticket' }
      ]
    };

    const result = await validateDeletion(trx, config, 'cat-1', 'tenant-1');

    expect(result.dependencies[0].label).toBe('tickets');
  });

  it('T012: pluralizes labels ending in s correctly', async () => {
    const { trx } = makeTrx(2);
    const config: EntityDeletionConfig = {
      entityType: 'status',
      dependencies: [
        { type: 'status', table: 'statuses', foreignKey: 'status_id', label: 'status' }
      ]
    };

    const result = await validateDeletion(trx, config, 'status-1', 'tenant-1');

    expect(result.dependencies[0].label).toBe('statuses');
  });

  it('T013: block message includes all dependency labels joined with commas', async () => {
    const { trx, builder } = makeTrx(1);
    builder.first
      .mockResolvedValueOnce({ count: '1' })
      .mockResolvedValueOnce({ count: '2' });

    const config: EntityDeletionConfig = {
      entityType: 'client',
      dependencies: [
        { type: 'ticket', table: 'tickets', foreignKey: 'client_id', label: 'ticket' },
        { type: 'project', table: 'projects', foreignKey: 'client_id', label: 'project' }
      ]
    };

    const result = await validateDeletion(trx, config, 'client-1', 'tenant-1');

    expect(result.message).toContain('1 ticket, 2 projects');
  });

  it('T014: includes Mark as Inactive alternative when supportsInactive is true', async () => {
    const { trx } = makeTrx(1);
    const config: EntityDeletionConfig = {
      entityType: 'client',
      supportsInactive: true,
      dependencies: [
        { type: 'ticket', table: 'tickets', foreignKey: 'client_id', label: 'ticket' }
      ]
    };

    const result = await validateDeletion(trx, config, 'client-1', 'tenant-1');

    expect(result.alternatives.some((alt) => alt.action === 'deactivate')).toBe(true);
  });

  it('T015: includes Archive alternative when supportsArchive is true', async () => {
    const { trx } = makeTrx(1);
    const config: EntityDeletionConfig = {
      entityType: 'project',
      supportsArchive: true,
      dependencies: [
        { type: 'ticket', table: 'tickets', foreignKey: 'project_id', label: 'ticket' }
      ]
    };

    const result = await validateDeletion(trx, config, 'project-1', 'tenant-1');

    expect(result.alternatives.some((alt) => alt.action === 'archive')).toBe(true);
  });

  it('T016: alternatives are empty when neither supportsInactive nor supportsArchive', async () => {
    const { trx } = makeTrx(1);
    const config: EntityDeletionConfig = {
      entityType: 'team',
      dependencies: [
        { type: 'ticket', table: 'tickets', foreignKey: 'team_id', label: 'ticket' }
      ]
    };

    const result = await validateDeletion(trx, config, 'team-1', 'tenant-1');

    expect(result.alternatives).toEqual([]);
  });

  it('T017: viewUrl is populated from viewUrlTemplate', async () => {
    const { trx } = makeTrx(1);
    const dependency: EntityDependencyConfig = {
      type: 'ticket',
      table: 'tickets',
      foreignKey: 'client_id',
      label: 'ticket',
      viewUrlTemplate: '/tickets/:id'
    };
    const config: EntityDeletionConfig = {
      entityType: 'client',
      dependencies: [dependency]
    };

    const result = await validateDeletion(trx, config, 'client-1', 'tenant-1');

    expect(result.dependencies[0].viewUrl).toBe('/tickets/client-1');
  });

  it('T018: viewUrl is undefined when viewUrlTemplate is not configured', async () => {
    const { trx } = makeTrx(1);
    const config: EntityDeletionConfig = {
      entityType: 'client',
      dependencies: [
        { type: 'ticket', table: 'tickets', foreignKey: 'client_id', label: 'ticket' }
      ]
    };

    const result = await validateDeletion(trx, config, 'client-1', 'tenant-1');

    expect(result.dependencies[0].viewUrl).toBeUndefined();
  });
});
