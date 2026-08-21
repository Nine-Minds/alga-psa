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
const REPO_ROOT = join(COMPONENTS, '..', '..', '..', '..');
const read = (file: string) => readFileSync(join(COMPONENTS, file), 'utf8');
const readRepo = (file: string) => readFileSync(join(REPO_ROOT, file), 'utf8');

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

/**
 * The remembered board tab is an *arrival* too, and it used to be applied by a
 * client effect that ran once the preference resolved — after first paint, with
 * its own fetch and its own history write. That write could land after the user
 * had already clicked into a ticket, replacing the entry the router had just
 * pushed and bouncing them back to the list on the restored board. It is
 * resolved on the server now, and the wiring that keeps it honest — same shared
 * resolvers, same precedence — is a cross-file property no unit test sees.
 */
describe('initial board resolution moved to the server', () => {
  const container = read('TicketingDashboardContainer.tsx');
  const page = readRepo('server/src/app/msp/tickets/page.tsx');

  it('leaves no client-side restore effect behind', () => {
    expect(container).not.toContain('resolveInitialBoardTab({');
    expect(container).not.toContain('hasBoardFilterParam(');
    expect(container).not.toContain("boardArrivalFilters(decision.boardId");
  });

  it('still records the tab the user moves to', () => {
    // Only the *restore* moved; remembering is still a client concern, because
    // only the client knows a tab was clicked.
    expect(container).toContain('setStoredActiveBoard(');
    expect(container).toContain('TICKETS_LAST_ACTIVE_BOARD_SETTING');
  });

  it('resolves the remembered board on the server before the list fetch', () => {
    expect(page).toContain('TICKETS_LAST_ACTIVE_BOARD_SETTING');
    // A stored board that no longer exists must be dropped, not rendered.
    expect(page).toContain('findBoardById');
    // A URL that names a board still wins outright.
    expect(page).toContain('hasBoardFilterParam');
  });

  it('applies the board default view through the same shared resolvers', () => {
    // Not a second, server-flavoured copy of the arrival rules: the board's
    // stored document is sanitized, layered over the tenant document, validated
    // on read, and folded in by buildBoardArrivalFilters — exactly as a tab
    // click does on the client.
    for (const resolver of [
      'sanitizeStoredTicketView',
      'resolveTicketViewSettings',
      'validateCapturedFilters',
      'buildBoardArrivalFilters',
    ]) {
      expect(page).toContain(resolver);
    }
    // …and only when the entry URL expressed no filter opinion of its own.
    expect(page).toContain('hasTicketViewFilterParams');
  });
});

/**
 * The reported bug in one line: the list writes its own state into the address
 * bar, and `router.push` is asynchronous, so a write that lands while the push
 * is in flight replaces the entry the router just made. Every route change out
 * of this screen therefore has to announce itself first.
 */
describe('navigating away stops the URL sync', () => {
  const dashboard = read('TicketingDashboard.tsx');
  const container = read('TicketingDashboardContainer.tsx');

  it('routes every navigation out of the list through the announcing helper', () => {
    const pushes = dashboard.match(/router\.push\(/g) ?? [];
    // Exactly one: the one inside navigateAwayTo.
    expect(pushes).toHaveLength(1);
    expect(dashboard).toMatch(/const navigateAwayTo = useCallback\(\(href: string\) => \{\s*onNavigateAway\?\.\(\);\s*router\.push\(href\);/);
  });

  it('wires the departure signal from the dashboard to the container', () => {
    expect(container).toContain('onNavigateAway={markNavigatingAway}');
    expect(container).toContain('navigatingAwayRef.current = true');
  });

  it('lifts the flag again when the list is back on top', () => {
    // Export/Import/bulk are intercepted routes — the list is never unmounted —
    // so a one-way flag would silently retire the URL sync for the session.
    expect(container).toContain('usePathname()');
    expect(container).toContain('navigatingAwayRef.current = false');
  });

  it('guards the URL write itself rather than each call site', () => {
    const start = container.indexOf('const updateURLWithFilters = useCallback(');
    expect(start).toBeGreaterThan(-1);
    const guard = container.slice(start, container.indexOf('const params = new URLSearchParams()', start));
    expect(guard).toContain('shouldWriteTicketListUrl');
    // The write is abandoned, not recorded: the "last applied search" must
    // still describe what this screen last rendered, so a later popstate can
    // tell that the URL has moved.
    expect(guard).not.toContain('lastAppliedSearchRef.current =');
  });
});
