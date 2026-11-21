// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { IBoard, IPriority } from '@alga-psa/types';
import { getBoardDefaultPriorityId, getDefaultPriorityId } from './boardDefaultPriority';

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
