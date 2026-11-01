import { describe, expect, it } from 'vitest';
import { evaluatePredicate, type PredicateGroup } from '@alga-psa/predicates';
import { checklistWhereForOwner, checklistWhereTagIds, readChecklistWhere } from '../rulePredicates';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const board = { path: 'board_id', operator: 'equals', value: other } as const;
const owned = { path: 'client.id', operator: 'in', value: [owner] } as const;

describe('checklist persisted predicate format', () => {
  it('rejects unknown versions and malformed or invalid nested leaves', () => {
    expect(() => readChecklistWhere({ join: 'and', clauses: [] }, 2)).toThrow(
      'Unsupported checklist rule version: 2'
    );
    for (const where of [
      {
        join: 'and',
        clauses: [{ join: 'or', clauses: [{ path: 'missing', operator: 'equals', value: 'x' }] }],
      },
      { join: 'and', clauses: [{ path: 'board_id', operator: 'equals', value: 'x' }] },
      { join: 'and', clauses: [{ path: 'client.tags', operator: 'contains', value: other }] },
      { join: 'and', clauses: [{ path: 'client.tags', operator: 'in', value: owner }] },
    ])
      expect(() => readChecklistWhere(where, 1)).toThrow();
  });

  it('rejects other-client values even inside nested OR branches', () => {
    expect(() =>
      checklistWhereForOwner(
        readChecklistWhere(
          {
            join: 'or',
            clauses: [
              board,
              { join: 'and', clauses: [{ path: 'client.id', operator: 'in', value: [owner, other] }] },
            ],
          },
          1
        ),
        owner
      )
    ).toThrow(other);
  });

  it('substitutes owner clauses with true without changing nested Boolean semantics', () => {
    for (const where of [
      { join: 'and', clauses: [owned, board] },
      { join: 'or', clauses: [owned, board] },
      { join: 'and', clauses: [{ join: 'or', clauses: [owned, board] }, board] },
      {
        join: 'or',
        clauses: [
          { join: 'and', clauses: [owned, board] },
          { join: 'or', clauses: [] },
        ],
      },
    ]) {
      const parsed = readChecklistWhere(where, 1);
      const normalized = checklistWhereForOwner(parsed, owner);
      for (const board_id of [owner, other, null]) {
        const ticket = { client: { id: owner }, board_id };
        expect(evaluatePredicate(normalized, ticket)).toBe(evaluatePredicate(parsed, ticket));
      }
    }
    expect(
      checklistWhereForOwner(readChecklistWhere({ join: 'or', clauses: [owned, board] }, 1), owner)
    ).toEqual({ join: 'and', clauses: [] });
  });

  it('keeps null comparisons and empty client sets, which are not redundant owner clauses', () => {
    for (const clause of [
      { path: 'client.id', operator: 'equals', value: null },
      { path: 'client.id', operator: 'in', value: [] },
    ]) {
      const parsed = readChecklistWhere({ join: 'and', clauses: [clause] }, 1);
      expect(evaluatePredicate(checklistWhereForOwner(parsed, owner), { client: { id: owner } })).toBe(false);
    }
  });

  it('collects tag references recursively and deduplicates definition ids', () => {
    const where: PredicateGroup = {
      join: 'and',
      clauses: [
        { path: 'client.tags', operator: 'in', value: [owner] },
        { join: 'or', clauses: [{ path: 'contact.tags', operator: 'not_in', value: [owner, other] }] },
      ],
    };
    expect(checklistWhereTagIds(where)).toEqual([owner, other]);
  });
});
