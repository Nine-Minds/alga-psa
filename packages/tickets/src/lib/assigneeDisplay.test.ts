import { describe, expect, it } from 'vitest';
import { savedAssigneeName, unresolvedAssigneeLabel } from './assigneeDisplay';

describe('unresolvedAssigneeLabel', () => {
  const base = { savedAssigneeName: 'Alice Liddell', selectableUserIds: ['u-1'] };

  it('names a disclosed assignee whose identity is withheld', () => {
    expect(unresolvedAssigneeLabel({ ...base, savedAssigneeId: undefined, currentValue: undefined })).toBe('Alice Liddell');
  });

  it('names a saved assignee the picker no longer offers', () => {
    expect(unresolvedAssigneeLabel({ ...base, savedAssigneeId: 'u-gone', currentValue: 'u-gone' })).toBe('Alice Liddell');
  });

  it('defers to the picker when it can name the assignee itself', () => {
    expect(unresolvedAssigneeLabel({ ...base, savedAssigneeId: 'u-1', currentValue: 'u-1' })).toBeNull();
  });

  it('stops describing the saved assignee once another choice is pending', () => {
    expect(unresolvedAssigneeLabel({ ...base, savedAssigneeId: 'u-gone', currentValue: '' })).toBeNull();
    expect(unresolvedAssigneeLabel({ ...base, savedAssigneeId: 'u-gone', currentValue: 'u-1' })).toBeNull();
  });

  it('has nothing to say without a name', () => {
    expect(unresolvedAssigneeLabel({ ...base, savedAssigneeName: '  ', savedAssigneeId: undefined, currentValue: undefined })).toBeNull();
    expect(unresolvedAssigneeLabel({ ...base, savedAssigneeName: null, savedAssigneeId: undefined, currentValue: undefined })).toBeNull();
  });
});

describe('savedAssigneeName', () => {
  const visible = [{ user_id: 'msp-1', first_name: 'Sierra', last_name: 'Visible' }, { user_id: 'seat-1', first_name: 'Glinda', last_name: 'Seat' }];

  it('keeps the name the ticket row carries', () => {
    expect(savedAssigneeName('msp-1', 'Row Name', visible)).toBe('Row Name');
  });

  it('names a visible but non-assignable assignee from the visible people, so the label is never "Not assigned"', () => {
    const name = savedAssigneeName('msp-1', undefined, visible);
    expect(name).toBe('Sierra Visible');
    // The control offers only the assignable people; the label still names the saved assignee.
    expect(unresolvedAssigneeLabel({ savedAssigneeId: 'msp-1', savedAssigneeName: name, currentValue: 'msp-1', selectableUserIds: ['seat-1'] }))
      .toBe('Sierra Visible');
  });

  it('has no name for no assignee or someone the caller cannot see', () => {
    expect(savedAssigneeName(null, undefined, visible)).toBeNull();
    expect(savedAssigneeName('hidden', undefined, visible)).toBeNull();
  });
});
