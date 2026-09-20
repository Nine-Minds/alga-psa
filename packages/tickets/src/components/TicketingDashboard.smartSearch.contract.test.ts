// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('ticketing dashboard smart search wiring contract', () => {
  const source = read('./TicketingDashboard.tsx');

  it('enters smart mode from Enter in the search box and from the Smart search button, gated on availability', () => {
    expect(source).toContain("useSmartTicketSearchAvailability()");
    expect(source).toContain("if (e.key === 'Enter' && smartSearchAvailable && searchQuery.trim().length > 0) {");
    expect(source).toContain('runSmartSearch(searchQuery);');
    expect(source).toContain('id={`${id}-smart-search-run`}');
    expect(source).toContain("{smartSearchAvailable && (");
  });

  it('keeps the typed text out of the keyword filter while smart mode is active', () => {
    const emitStart = source.indexOf('// Emit debounced search query changes to the container');
    const emitEnd = source.indexOf('}, [debouncedSearchQuery]);', emitStart);
    expect(emitStart).toBeGreaterThanOrEqual(0);
    expect(emitEnd).toBeGreaterThan(emitStart);
    const emitEffect = source.slice(emitStart, emitEnd);
    expect(emitEffect).toContain('if (smartSearch.active) {');
    expect(emitEffect).toContain('return;');

    // Entering smart mode clears any keyword filter the container still holds.
    const runStart = source.indexOf('const runSmartSearch = useCallback(');
    const runEnd = source.indexOf('const rerunSmartSearch', runStart);
    const run = source.slice(runStart, runEnd);
    expect(run).toContain("onFilterChange({ searchQuery: '' });");
    expect(run).toContain('clearSelection();');
  });

  it('scores the chip filters only and offers a rerun when they change', () => {
    expect(source).toContain("const smartSearchFilters = useMemo((): ITicketListFilters => ({ ...exportFilters, searchQuery: '' }), [exportFilters]);");
    expect(source).toContain('const smartSearchFiltersStale = smartSearch.active && smartSearch.filtersKey !== smartSearchFiltersKey;');
    expect(source).toContain('filtersStale={smartSearchFiltersStale}');
    expect(source).toContain('onRerun={rerunSmartSearch}');
  });

  it('replaces the paginated table with the results panel, sharing columns, row click, and visible-row tracking', () => {
    const regionStart = source.indexOf('<ShortcutActiveRegion id="tickets-shortcut-region"');
    const regionEnd = source.indexOf('</ShortcutActiveRegion>', regionStart);
    const region = source.slice(regionStart, regionEnd);
    expect(region).toContain('{smartSearch.active ? (');
    expect(region).toContain('<SmartTicketSearchResults');
    expect(region).toContain('columns={columns}');
    expect(region).toContain('onVisibleRowsChange={handleVisibleRowsChange}');
    expect(region).toContain('onRowMetadata={handleSmartSearchRowMetadata}');
    expect(region).toContain('onExit={exitSmartSearch}');
    expect(region).toContain('<DataTable');
  });

  it('leaves smart mode when the box is cleared, on Escape, and on Reset', () => {
    expect(source).toContain("if (smartSearch.active && searchQuery === '') {");
    expect(source).toContain("} else if (e.key === 'Escape' && smartSearch.active) {");
    const resetStart = source.indexOf('const handleResetFilters = useCallback(() => {');
    const resetSlice = source.slice(resetStart, resetStart + 400);
    expect(resetSlice).toContain('setSmartSearch((prev) => (prev.active ? { ...prev, active: false } : prev));');
  });

  it('does not mirror smart mode into the URL', () => {
    // The URL param writer only knows the keyword filter; smart mode is local state.
    expect(source).not.toMatch(/params\.set\(['"]smart/);
  });

  it('select-all-matching uses the same filter assembly as export, so a custom due-date range is honored', () => {
    const start = source.indexOf('const handleSelectAllMatchingTickets = useCallback(');
    const end = source.indexOf('const handleBulkMoveBoardChange', start);
    const body = source.slice(start, end);
    expect(body).toContain('getAllMatchingTicketIds(exportFilters)');
    expect(body).not.toContain('boardIds: selectedBoards');
  });
});
