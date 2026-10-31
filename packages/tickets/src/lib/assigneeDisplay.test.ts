import { describe, expect, it } from 'vitest';
import { unresolvedAssigneeLabel } from './assigneeDisplay';

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
