/**
 * The whole-fleet software sync processes a batch of devices concurrently, so
 * devices reporting the same title for the first time race to create its
 * software_catalog row. Before the fix every loser of that race failed with
 * idx_software_catalog_unique_name_publisher and was counted as a failed
 * device (23 of the first 25 on a fresh catalog in the review run).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface CatalogRow {
  software_id: string;
  normalized_name: string;
  publisher: string | null;
}

let catalog: CatalogRow[] = [];
let nextId = 0;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const matches = (row: CatalogRow, where: Partial<CatalogRow>) =>
  row.normalized_name === where.normalized_name && row.publisher === where.publisher;

/** In-memory software_catalog with the (tenant, normalized_name, publisher) unique key. */
function catalogTable() {
  let where: Partial<CatalogRow> = {};
  const builder = {
    where(filter: Partial<CatalogRow>) {
      where = filter;
      return builder;
    },
    async first() {
      await tick(); // let concurrent callers all miss before anyone inserts
      return catalog.find((row) => matches(row, where));
    },
    insert(values: CatalogRow & { name: string }) {
      let ignoreConflict = false;
      const run = async () => {
        await tick();
        if (catalog.some((row) => matches(row, values))) {
          if (ignoreConflict) return [];
          throw new Error('duplicate key value violates unique constraint "idx_software_catalog_unique_name_publisher"');
        }
        const row = { software_id: `sw-${++nextId}`, normalized_name: values.normalized_name, publisher: values.publisher };
        catalog.push(row);
        return [{ software_id: row.software_id }];
      };
      const chain = {
        onConflict: () => ({
          ignore: () => {
            ignoreConflict = true;
            return chain;
          },
        }),
        returning: () => run(),
      };
      return chain;
    },
  };
  return builder;
}

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: () => catalogTable() }),
}));
vi.mock('@/lib/db', () => ({ createTenantKnex: vi.fn() }));
vi.mock('../../../lib/integrations/ninjaone/ninjaOneClient', () => ({ createNinjaOneClient: vi.fn() }));

const { findOrCreateSoftwareCatalogEntry } = await import('../../../lib/integrations/ninjaone/sync/softwareSync');

describe('findOrCreateSoftwareCatalogEntry under a concurrent batch', () => {
  beforeEach(() => {
    catalog = [];
    nextId = 0;
  });

  it('gives every concurrent device the same catalog row instead of failing the losers', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, () =>
        findOrCreateSoftwareCatalogEntry({} as never, 'tenant-1', { name: 'Google Chrome', publisher: 'Google LLC' }),
      ),
    );

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const ids = new Set(results.map((r) => (r as PromiseFulfilledResult<string>).value));
    expect(ids).toEqual(new Set(['sw-1']));
    expect(catalog).toHaveLength(1);
  });

  it('still returns an existing entry without inserting', async () => {
    catalog.push({ software_id: 'sw-existing', normalized_name: 'zoom workplace', publisher: 'Zoom Video Communications, Inc.' });
    await expect(
      findOrCreateSoftwareCatalogEntry({} as never, 'tenant-1', {
        name: 'Zoom Workplace',
        publisher: 'Zoom Video Communications, Inc.',
      }),
    ).resolves.toBe('sw-existing');
    expect(catalog).toHaveLength(1);
  });
});
