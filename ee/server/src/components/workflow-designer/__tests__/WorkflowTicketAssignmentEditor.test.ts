import { describe, expect, it, vi } from 'vitest';

vi.mock('../WorkflowActionInputFixedPicker', () => ({
  WorkflowActionInputFixedPicker: () => null,
  WorkflowActionInputFixedMultiPicker: () => null,
}));

import { readTicketAssignmentLiteral, writeTicketAssignmentLiteral } from '../WorkflowTicketAssignmentEditor';

describe('ticket assignment literal helpers', () => {
  it('reads empty, user, and team assignments', () => {
    expect(readTicketAssignmentLiteral(undefined)).toEqual({ primary: null, additionalUserIds: [] });
    expect(readTicketAssignmentLiteral({ primary: null, additional_user_ids: [] })).toEqual({ primary: null, additionalUserIds: [] });
    expect(readTicketAssignmentLiteral({ primary: { type: 'user', id: 'u1' }, additional_user_ids: ['u2'] })).toEqual({
      primary: { type: 'user', id: 'u1' },
      additionalUserIds: ['u2'],
    });
    expect(readTicketAssignmentLiteral({ primary: { type: 'queue', id: 't1' } })).toEqual({
      primary: { type: 'queue', id: 't1' },
      additionalUserIds: [],
    });
  });

  it('treats a primary without an id as unassigned', () => {
    expect(readTicketAssignmentLiteral({ primary: { type: 'user' } })).toEqual({ primary: null, additionalUserIds: [] });
  });

  it('returns null for values that only the field-by-field editor can show', () => {
    expect(readTicketAssignmentLiteral({ $expr: 'vars.assignment' })).toBeNull();
    expect(readTicketAssignmentLiteral({ primary: { type: 'user', id: { $expr: 'payload.userId' } } })).toBeNull();
    expect(readTicketAssignmentLiteral({ primary: { $expr: 'vars.primary' } })).toBeNull();
    expect(readTicketAssignmentLiteral({ primary: { type: 'robot', id: 'x' } })).toBeNull();
    expect(readTicketAssignmentLiteral({ additional_user_ids: { $expr: 'vars.ids' } })).toBeNull();
    expect(readTicketAssignmentLiteral('u1')).toBeNull();
  });

  it('writes the action input shape and drops additional users without a primary assignee', () => {
    expect(writeTicketAssignmentLiteral({ primary: { type: 'team', id: 't1' }, additionalUserIds: ['u2'] })).toEqual({
      primary: { type: 'team', id: 't1' },
      additional_user_ids: ['u2'],
    });
    expect(writeTicketAssignmentLiteral({ primary: null, additionalUserIds: ['u2'] })).toEqual({
      primary: null,
      additional_user_ids: [],
    });
  });
});
