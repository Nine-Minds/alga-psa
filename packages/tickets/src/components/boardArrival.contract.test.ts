// @vitest-environment node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * There are two ways to land on a single board — the tab strip and the board
 * filter picker — and `resolveActiveBoardId` treats them identically, which is
 * what makes the board header and the board-scoped status options light up for
 * both. The board's *view* has to follow the same rule, or the header names one
 * board while the columns, density and filters still belong to the previous one.
 *
 * Both paths therefore have to reach `handleFilterChange` with `activeBoardTab`
 * set, which is the flag the container keys arrival off. That is a wiring
 * property, invisible to a pure unit test and awkward to drive through the
 * picker's tree UI, so it is asserted against the source.
 */

const COMPONENTS = __dirname;
const read = (file: string) => readFileSync(join(COMPONENTS, file), 'utf8');

function sliceCallback(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = useCallback(`);
  expect(start, `${name} should exist`).toBeGreaterThan(-1);
  const next = source.indexOf('const handle', start + 10);
  return source.slice(start, next > start ? next : start + 2000);
}

describe('board arrival wiring', () => {
  const dashboard = read('TicketingDashboard.tsx');

  it('routes a single-board picker selection through the arrival path', () => {
    const body = sliceCallback(dashboard, 'handleBoardSelect');

    // Same derivation the header and status options use, not a second one.
    expect(body).toContain('resolveActiveBoardId');
    expect(body).toContain('activeBoardTab');
  });

  it('does not treat a multi-board picker selection as an arrival', () => {
    // Zero or several boards is a filter, not a place: there is no single board
    // whose view could apply, so it must not claim to be an arrival.
    const body = sliceCallback(dashboard, 'handleBoardSelect');
    expect(body).toMatch(/nextBoardId !== null/);
  });

  it('keeps the tab strip on the same arrival path', () => {
    const body = sliceCallback(dashboard, 'handleBoardTabSelect');
    expect(body).toContain('activeBoardTab');
    // Tabs additionally push history; the picker deliberately does not.
    expect(body).toContain('pushHistory: true');
  });

  it('decides arrival from the entry URL, never from the live one', () => {
    // The regression this whole seam exists for: updateURLWithFilters writes the
    // app's own filter state back into the address bar, so re-reading
    // window.location.search per click reports an opinion that is not a shared
    // link — and silently disables board default filters from the second
    // navigation onwards.
    const container = read('TicketingDashboardContainer.tsx');
    const handler = container.slice(container.indexOf('const handleFilterChange = useCallback('));
    const body = handler.slice(0, handler.indexOf('const handleSortChange'));

    expect(body).toContain("'tab-click'");
    expect(body).not.toContain('window.location.search');
    // The entry-URL probe is a ref captured once, not a per-call read.
    expect(container).toContain('const entryUrlHasFilterOpinion = useRef(');
  });
});
