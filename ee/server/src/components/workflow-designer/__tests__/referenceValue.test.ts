import { describe, expect, it } from 'vitest';

import {
  buildReferenceExpression,
  getOneItemListReferencePath,
  getReferenceExpressionType,
} from '../mapping/referenceValue';
import { TypeCompatibility, canSendAsOneItemList, getTypeCompatibility } from '../mapping/typeCompatibility';
import { extractPrimaryPath } from '../workflowReferenceSelector';

describe('one-item-list references', () => {
  it('wraps a single value picked for a list input', () => {
    expect(buildReferenceExpression('vars.t.ticket.assigned_to', 'string', 'array<string>')).toBe('[vars.t.ticket.assigned_to]');
    expect(buildReferenceExpression('vars.t.ticket.assigned_to', 'string|null', 'array')).toBe('[vars.t.ticket.assigned_to]');
    expect(buildReferenceExpression('vars.t.count', 'number', 'array<number>')).toBe('[vars.t.count]');
  });

  it('leaves lists, objects, unknown types, and non-list targets alone', () => {
    expect(buildReferenceExpression('vars.t.ids', 'array<string>', 'array<string>')).toBe('vars.t.ids');
    expect(buildReferenceExpression('vars.t.ticket', 'object', 'array')).toBe('vars.t.ticket');
    expect(buildReferenceExpression('vars.t.x', undefined, 'array')).toBe('vars.t.x');
    expect(buildReferenceExpression('vars.t.title', 'string', 'string')).toBe('vars.t.title');
    expect(canSendAsOneItemList('boolean', 'array<number>')).toBe(false);
  });

  it('reads one-item-list references back as their field and as a list type', () => {
    expect(getOneItemListReferencePath('[vars.t.ticket.assigned_to]')).toBe('vars.t.ticket.assigned_to');
    expect(getOneItemListReferencePath(' [ payload.userId ] ')).toBe('payload.userId');
    expect(getOneItemListReferencePath('[a, b]')).toBeNull();
    expect(getOneItemListReferencePath('vars.t.ids')).toBeNull();
    expect(extractPrimaryPath('[vars.t.ticket.assigned_to]')).toBe('vars.t.ticket.assigned_to');
    expect(getReferenceExpressionType('[vars.t.ticket.assigned_to]', () => 'string|null')).toBe('array<string>');
    expect(getReferenceExpressionType('vars.t.ids', () => 'array')).toBeUndefined();
  });

  it('treats an untyped list and a typed list as matching', () => {
    expect(getTypeCompatibility('array<string>', 'array')).toBe(TypeCompatibility.EXACT);
    expect(getTypeCompatibility('array', 'array<string>')).toBe(TypeCompatibility.EXACT);
  });
});
