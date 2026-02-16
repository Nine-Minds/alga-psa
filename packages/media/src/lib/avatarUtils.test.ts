import { describe, expect, it, vi } from 'vitest';

vi.mock('./documentsHelpers', () => ({
  getImageUrlInternalAsync: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn(),
}));

describe('media avatarUtils batch helpers', () => {
  it('resolves image URLs in parallel', async () => {
    const { getEntityImageUrlsBatch } = await import('./avatarUtils');
    const { getImageUrlInternalAsync } = await import('./documentsHelpers');
    const { createTenantKnex } = await import('@alga-psa/db');

    const associations = [
      { entity_id: 'e1', document_id: 'd1' },
      { entity_id: 'e2', document_id: 'd2' },
    ];
    const documents = [
      { document_id: 'd1', file_id: 'f1', updated_at: new Date('2024-01-01T00:00:00Z') },
      { document_id: 'd2', file_id: 'f2', updated_at: new Date('2024-01-02T00:00:00Z') },
    ];

    const knexMock = (table: string) => ({
      select: () => ({
        whereIn: () => ({
          andWhere: () =>
            Promise.resolve(table === 'document_associations' ? associations : documents),
        }),
      }),
    });

    vi.mocked(createTenantKnex).mockResolvedValue({ knex: knexMock } as never);

    const resolvers: Array<() => void> = [];
    vi.mocked(getImageUrlInternalAsync).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(() => resolve('https://cdn.example.com/image.png'));
        })
    );

    const resultPromise = getEntityImageUrlsBatch('client', ['e1', 'e2'], 'tenant-1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolvers).toHaveLength(2);

    resolvers.forEach((resolve) => resolve());
    const result = await resultPromise;

    expect(result.get('e1')).toContain('https://cdn.example.com/image.png');
    expect(result.get('e2')).toContain('https://cdn.example.com/image.png');
  });
});
