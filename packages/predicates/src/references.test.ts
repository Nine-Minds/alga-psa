import { describe, expect, it } from 'vitest';
import { predicateReferencesValue } from './references';
import type { PredicateNode } from './types';

describe('predicate value references', () => {
  it.each(['equals', 'not_equals', 'in', 'not_in'] as const)('finds %s references in nested groups', (operator) => {
    const node: PredicateNode = { join: 'and', clauses: [{ join: 'or', clauses: [
      { path: 'board_id', operator, value: operator.endsWith('in') ? ['board', 'other'] : 'board' },
    ] }] };
    expect(predicateReferencesValue(node, 'board_id', 'board')).toBe(true);
    expect(predicateReferencesValue(node, 'client.id', 'board')).toBe(false);
    expect(predicateReferencesValue(node, 'board_id', 'absent')).toBe(false);
  });

  it('does not confuse empty groups or valueless conditions with references', () => {
    expect(predicateReferencesValue({ join: 'and', clauses: [] }, 'board_id', 'board')).toBe(false);
    expect(predicateReferencesValue({ path: 'board_id', operator: 'is_empty' }, 'board_id', 'board')).toBe(false);
  });
});
