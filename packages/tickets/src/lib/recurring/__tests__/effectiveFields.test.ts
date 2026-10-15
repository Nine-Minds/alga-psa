import { describe, expect, it } from 'vitest';
import { recurringTicketOverridesSchema, resolveEffectiveFields } from '../effectiveFields';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const defaults = {
  board_id: id(1),
  status_id: id(2),
  priority_id: id(3),
  category_id: id(4),
  subcategory_id: id(5),
  assigned_to: id(6),
  assigned_team_id: null,
  additional_agent_ids: [id(7)],
};

describe('recurringTicketOverridesSchema', () => {
  it('accepts an empty override set (everything inherited)', () => {
    expect(recurringTicketOverridesSchema.parse({})).toEqual({});
  });

  it('accepts every group', () => {
    const overrides = {
      board: { board_id: id(10), status_id: null },
      priority: { priority_id: id(11) },
      category: { category_id: null, subcategory_id: null },
      assignment: { assigned_to: null, assigned_team_id: id(12), additional_agent_ids: [] },
    };
    expect(recurringTicketOverridesSchema.parse(overrides)).toEqual(overrides);
  });

  it('requires a board override to carry its status (null = board default)', () => {
    expect(recurringTicketOverridesSchema.safeParse({ board: { board_id: id(10) } }).success).toBe(false);
  });

  it('rejects a subcategory without a category', () => {
    const result = recurringTicketOverridesSchema.safeParse({ category: { category_id: null, subcategory_id: id(5) } });
    expect(result.success).toBe(false);
  });

  it('rejects unknown groups and unknown fields inside a group', () => {
    expect(recurringTicketOverridesSchema.safeParse({ title: 'x' }).success).toBe(false);
    expect(recurringTicketOverridesSchema.safeParse({ priority: { priority_id: id(1), extra: 1 } }).success).toBe(false);
  });

  it('rejects non-uuid ids', () => {
    expect(recurringTicketOverridesSchema.safeParse({ priority: { priority_id: 'high' } }).success).toBe(false);
    expect(
      recurringTicketOverridesSchema.safeParse({ assignment: { assigned_to: null, assigned_team_id: null, additional_agent_ids: ['x'] } }).success
    ).toBe(false);
  });
});

describe('resolveEffectiveFields', () => {
  it('inherits everything when there are no overrides', () => {
    expect(resolveEffectiveFields(defaults, {})).toEqual(defaults);
  });

  it('replaces a board group as a unit, including a null status', () => {
    const result = resolveEffectiveFields(defaults, { board: { board_id: id(10), status_id: null } });
    expect(result.board_id).toBe(id(10));
    expect(result.status_id).toBeNull();
    expect(result.priority_id).toBe(defaults.priority_id);
  });

  it('lets an assignment override mean "unassigned"', () => {
    const result = resolveEffectiveFields(defaults, {
      assignment: { assigned_to: null, assigned_team_id: null, additional_agent_ids: [] },
    });
    expect(result.assigned_to).toBeNull();
    expect(result.assigned_team_id).toBeNull();
    expect(result.additional_agent_ids).toEqual([]);
  });

  it('clears category and subcategory together', () => {
    const result = resolveEffectiveFields(defaults, { category: { category_id: null, subcategory_id: null } });
    expect(result.category_id).toBeNull();
    expect(result.subcategory_id).toBeNull();
  });

  it('applies independent groups independently', () => {
    const result = resolveEffectiveFields(defaults, { priority: { priority_id: id(11) } });
    expect(result).toEqual({ ...defaults, priority_id: id(11) });
  });
});
