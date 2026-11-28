// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The full dashboard is too heavy to render in a unit test, so this guards the
 * wiring that used to throw away DataTable state ("Show all") on every fetch.
 * The behavioural half (a mounted DataTable keeps Show all through sort/page/
 * page-size prop changes) lives in packages/ui DataTable.showAllColumns.test.tsx.
 */
describe('ticket list keeps its DataTable mounted across fetches', () => {
  const source = fs.readFileSync(path.resolve(__dirname, './TicketingDashboard.tsx'), 'utf8');

  it('only swaps the table for a spinner when there are no rows yet', () => {
    expect(source).toContain('isLoadingMore && !smartSearch.active && ticketsWithIds.length === 0');
  });

  it('does not key the DataTable on page or page size', () => {
    expect(source).not.toContain('key={`${currentPage}-${pageSize}`}');
    const tableStart = source.indexOf('<DataTable');
    const tableTag = source.slice(tableStart, source.indexOf('/>', tableStart));
    expect(tableTag).not.toMatch(/\bkey=/);
    expect(tableTag).toContain('id={`${id}-tickets-table`}');
  });

  it('still prunes selection when the page rows change', () => {
    expect(source).toContain('pruneSelectedTicketIds(prev, new Set(selectableTicketIds), smartSearch.active)');
  });
});
