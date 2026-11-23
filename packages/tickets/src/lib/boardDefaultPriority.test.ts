// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { IBoard, IPriority } from '@alga-psa/types';
import {
  filterPrioritiesForBoard,
  getBoardDefaultPriorityId,
  getDefaultPriorityId,
  priorityFitsBoardKind,
} from './boardDefaultPriority';

const customPriority = (id: string, name: string): IPriority => ({
  tenant: 'tenant-1',
  priority_id: id,
  priority_name: name,
  order_number: 1,
  color: '#000000',
  created_by: 'user-1',
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  item_type: 'ticket',
  is_from_itil_standard: false,
} as IPriority);

const itilPriority = (id: string, name: string, level: number): IPriority => ({
  ...customPriority(id, name),
  is_from_itil_standard: true,
  itil_priority_level: level,
} as IPriority);

const board = (overrides: Partial<IBoard>): IBoard => ({
  tenant: 'tenant-1',
  board_id: 'board-1',
  board_name: 'Support',
  is_inactive: false,
  ...overrides,
} as IBoard);

const customPriorities = [
  customPriority('custom-low', 'Low'),
  customPriority('custom-high', 'High'),
];

const itilPriorities = [
  itilPriority('itil-1', 'P1 - Critical', 1),
  itilPriority('itil-3', 'P3 - Medium', 3),
  itilPriority('itil-5', 'P5 - Planning', 5),
];

describe('getDefaultPriorityId', () => {
  it('returns the first custom priority for a custom board', () => {
    expect(getDefaultPriorityId([...itilPriorities, ...customPriorities], 'custom')).toBe('custom-low');
  });

  it('returns ITIL level 3 for an ITIL board', () => {
    expect(getDefaultPriorityId([...customPriorities, ...itilPriorities], 'itil')).toBe('itil-3');
  });

  it('falls back to the first ITIL priority when no level 3 exists', () => {
    expect(getDefaultPriorityId([itilPriority('itil-2', 'P2 - High', 2)], 'itil')).toBe('itil-2');
  });

  it('returns an empty string when there are no priorities', () => {
    expect(getDefaultPriorityId([], 'custom')).toBe('');
    expect(getDefaultPriorityId([], 'itil')).toBe('');
  });
});

describe('getBoardDefaultPriorityId', () => {
  it("uses the board's configured default when it is available and type-matched", () => {
    expect(
      getBoardDefaultPriorityId(
        board({ default_priority_id: 'custom-high', priority_type: 'custom' }),
        customPriorities
      )
    ).toBe('custom-high');

    expect(
      getBoardDefaultPriorityId(
        board({ default_priority_id: 'itil-5', priority_type: 'itil' }),
        itilPriorities
      )
    ).toBe('itil-5');
  });

  it('ignores an ITIL default on a custom board', () => {
    expect(
      getBoardDefaultPriorityId(
        board({ default_priority_id: 'itil-5', priority_type: 'custom' }),
        [...customPriorities, ...itilPriorities]
      )
    ).toBe('custom-low');
  });

  it('ignores a custom default on an ITIL board', () => {
    expect(
      getBoardDefaultPriorityId(
        board({ default_priority_id: 'custom-high', priority_type: 'itil' }),
        [...customPriorities, ...itilPriorities]
      )
    ).toBe('itil-3');
  });

  it('ignores a default that is not in the available list', () => {
    expect(
      getBoardDefaultPriorityId(
        board({ default_priority_id: 'priority-from-another-board', priority_type: 'custom' }),
        customPriorities
      )
    ).toBe('custom-low');
  });

  it('falls back when the board has no default', () => {
    expect(getBoardDefaultPriorityId(board({ default_priority_id: null }), customPriorities)).toBe('custom-low');
    expect(getBoardDefaultPriorityId(board({ priority_type: 'itil' }), itilPriorities)).toBe('itil-3');
    expect(getBoardDefaultPriorityId(undefined, customPriorities)).toBe('custom-low');
  });

  it('returns an empty string when the board has no priorities at all', () => {
    expect(getBoardDefaultPriorityId(board({ default_priority_id: 'custom-high' }), [])).toBe('');
  });
});

/**
 * T171 — F092 of `ee/plans/2026-11-21-itil-remediation` (`priority-pickers`).
 *
 * The one client-side answer to "which priorities does this board offer?" (R3). Every picker uses
 * it, so none of them can drift into offering a value the server then refuses.
 */
describe('filterPrioritiesForBoard', () => {
  const own = customPriority('custom-low', 'Low');
  const ownHigh = customPriority('custom-high', 'High');
  const itil = itilPriority('itil-3', 'P3 - Medium', 3);

  it('offers the ITIL family on an ITIL board and the tenant’s own elsewhere', () => {
    expect(filterPrioritiesForBoard([own, ownHigh, itil], 'itil')).toEqual([itil]);
    expect(filterPrioritiesForBoard([own, ownHigh, itil], 'custom')).toEqual([own, ownHigh]);
  });

  it('treats a missing or unknown kind as the tenant’s own', () => {
    expect(filterPrioritiesForBoard([own, itil], undefined)).toEqual([own]);
    expect(filterPrioritiesForBoard([own, itil], null)).toEqual([own]);
    expect(filterPrioritiesForBoard([own, itil], '')).toEqual([own]);
    expect(priorityFitsBoardKind(itil, undefined)).toBe(false);
    expect(priorityFitsBoardKind(own, undefined)).toBe(true);
  });

  it('keeps the value a ticket already carries listed, so a legacy row still renders (D3)', () => {
    expect(
      filterPrioritiesForBoard([own, itil], 'itil', { keep: (priority) => priority.priority_id === 'custom-low' })
    ).toEqual([own, itil]);
  });

  it('answers on the option shapes the pickers actually hold', () => {
    // The ticket screens pass `{ value, label, is_from_itil_standard }` rather than a priority row.
    const options = [
      { value: 'custom-low', label: 'Low', is_from_itil_standard: false },
      { value: 'itil-3', label: 'P3 - Medium', is_from_itil_standard: true },
      // A legacy option with no flag counts as the tenant's own.
      { value: 'legacy', label: 'Legacy' },
    ];
    expect(filterPrioritiesForBoard(options, 'itil').map((option) => option.value)).toEqual(['itil-3']);
    expect(filterPrioritiesForBoard(options, 'custom').map((option) => option.value)).toEqual([
      'custom-low',
      'legacy',
    ]);
  });
});
