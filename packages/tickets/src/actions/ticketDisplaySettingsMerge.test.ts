// @vitest-environment node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TicketViewSettings } from '../lib/ticketViewSettings';

/**
 * `tenant_settings.ticket_display_settings.list` has two writers that own
 * different subsets of the same document:
 *
 *   Settings → Display   authors columnVisibility + tagsInlineUnderTitle
 *   View ▾ → save default authors the whole document (incl. columnOrder,
 *                          densityLevel, filters)
 *
 * Before `list` widened past two keys both writers happened to send exactly the
 * same keys, so replacing the group wholesale was lossless. It is not any more:
 * whichever screen saves last would silently delete the other's keys, with no
 * error and nothing on screen to reveal it.
 *
 * updateTicketingDisplaySettings is a "use server" action wrapped in withAuth
 * and reaches straight for the database, so the merge rule is asserted here as
 * the pure function it is, plus a source check that the action actually applies
 * it on both the dedicated-column and legacy-nested paths.
 */

/** The rule the action implements: `list` merges key-group-wise. */
function mergeDisplaySettings(
  current: { list?: TicketViewSettings } & Record<string, unknown>,
  updated: { list?: TicketViewSettings } & Record<string, unknown>,
): Record<string, any> {
  const mergedList = updated.list ? { ...(current.list || {}), ...updated.list } : current.list;
  return { ...current, ...updated, ...(mergedList ? { list: mergedList } : {}) };
}

describe('tenant display settings list merge', () => {
  const savedFromViewMenu: TicketViewSettings = {
    columnVisibility: { status: true, client: false },
    columnOrder: ['client', 'status'],
    tagsInlineUnderTitle: true,
    densityLevel: 30,
    filters: { priorityId: 'p1', sortBy: 'due_date' },
  };

  it('keeps columnOrder, densityLevel and filters when Display Settings saves', () => {
    // The reported data loss: save an All-tickets default view, then change
    // anything on Settings → Display and save.
    const merged = mergeDisplaySettings(
      { list: savedFromViewMenu },
      { list: { columnVisibility: { status: false }, tagsInlineUnderTitle: false } },
    );

    expect(merged.list.columnOrder).toEqual(['client', 'status']);
    expect(merged.list.densityLevel).toBe(30);
    expect(merged.list.filters).toEqual({ priorityId: 'p1', sortBy: 'due_date' });
    // ...and the groups Display Settings does own are replaced.
    expect(merged.list.columnVisibility).toEqual({ status: false });
    expect(merged.list.tagsInlineUnderTitle).toBe(false);
  });

  it('keeps tagsInlineUnderTitle when the View menu saves without it', () => {
    // The reverse direction of the same bug.
    const merged = mergeDisplaySettings(
      { list: { columnVisibility: { status: true }, tagsInlineUnderTitle: false } },
      { list: { columnVisibility: { status: false }, densityLevel: 70 } },
    );

    expect(merged.list.tagsInlineUnderTitle).toBe(false);
    expect(merged.list.densityLevel).toBe(70);
  });

  it('replaces a named group wholesale rather than deep-merging it', () => {
    // Group-level, not per-key — the same rule the board→tenant resolver uses.
    const merged = mergeDisplaySettings(
      { list: { columnVisibility: { status: true, client: true, board: true } } },
      { list: { columnVisibility: { status: false } } },
    );
    expect(merged.list.columnVisibility).toEqual({ status: false });
  });

  it('leaves the whole list alone when a writer does not mention it', () => {
    const merged = mergeDisplaySettings(
      { list: savedFromViewMenu },
      { dateTimeFormat: 'yyyy-MM-dd' },
    );
    expect(merged.list).toEqual(savedFromViewMenu);
    expect(merged.dateTimeFormat).toBe('yyyy-MM-dd');
  });

  it('still replaces non-list keys wholesale', () => {
    const merged = mergeDisplaySettings(
      { dateTimeFormat: 'a', responseStateTrackingEnabled: true },
      { dateTimeFormat: 'b' },
    );
    expect(merged.dateTimeFormat).toBe('b');
    expect(merged.responseStateTrackingEnabled).toBe(true);
  });

  it('is applied by the action on both the column and the legacy nested path', () => {
    const source = readFileSync(join(__dirname, 'ticketDisplaySettings.ts'), 'utf8');
    const body = source.slice(source.indexOf('export const updateTicketingDisplaySettings'));

    // Two merge sites — the dedicated column and settings.ticketing.display —
    // because a partial write must mean the same thing on both.
    expect(body).toContain('const mergedList = updated.list');
    expect(body).toContain('const mergedNestedList = updated.list');
    // And neither may go back to a bare wholesale spread of `list`.
    expect(body).not.toMatch(/mergedDisplay = \{\s*\.\.\.currentDisplay,\s*\.\.\.updated,\s*\}/);
  });
});
