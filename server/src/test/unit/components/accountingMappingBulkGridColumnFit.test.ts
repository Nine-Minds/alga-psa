// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { ColumnDefinition } from '@alga-psa/types';
import { computeColumnFit, getColumnLayout, getColumnSizeConfig } from '@alga-psa/ui/components/dataTableColumnFit';
import { BULK_GRID_COLUMN_SIZES } from '@alga-psa/integrations/components/accounting-mappings/AccountingMappingBulkGrid';

// Same order, ids, dataIndexes and (Xero) titles as the grid's `columns` useMemo.
const columns: ColumnDefinition<any>[] = [
  { title: 'Save', dataIndex: 'selected', ...BULK_GRID_COLUMN_SIZES.selected },
  { title: 'Alga Service', dataIndex: 'name', ...BULK_GRID_COLUMN_SIZES.name },
  { title: 'Map To', dataIndex: 'kindId', ...BULK_GRID_COLUMN_SIZES.kindId },
  { title: 'Xero Target', dataIndex: 'externalId', ...BULK_GRID_COLUMN_SIZES.externalId },
  { title: 'Ignore', dataIndex: 'ignored', ...BULK_GRID_COLUMN_SIZES.ignored },
  { title: 'Status', dataIndex: 'id', ...BULK_GRID_COLUMN_SIZES.id },
];

const run = (width: number) => {
  const result = computeColumnFit(columns, width, getColumnLayout(columns, width));
  const sizes = columns.map(c => result.sizeOverrides[c.dataIndex as string] ?? getColumnSizeConfig(c).size);
  return { result, sizes };
};

describe('bulk mapping grid column fit', () => {
  it.each([824, 874, 1066, 1320, 1510])('keeps all six columns visible at %ipx', (width) => {
    const { result, sizes } = run(width);
    expect(result.visibleColumnIds).toEqual(['selected', 'name', 'kindId', 'externalId', 'ignored', 'id']);
    expect(sizes[3]).toBeGreaterThanOrEqual(240);
    // At or below the 1224px preferred total the table is exactly filled.
    if (width <= 1224) expect(sizes.reduce((a, b) => a + b, 0)).toBe(width);
    else expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(width);
  });

  it('shrinks to 72/168/148/274/72/140 at 874px', () => {
    expect(run(874).sizes).toEqual([72, 168, 148, 274, 72, 140]);
  });
});
