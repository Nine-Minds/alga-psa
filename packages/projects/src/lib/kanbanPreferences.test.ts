import { describe, expect, it } from 'vitest';
import {
  PROJECT_KANBAN_HIDDEN_STATUSES_SETTING,
  projectKanbanHiddenStatusesKey,
  getKanbanStatusIdentity,
  normalizeHiddenStatusIds,
  toggleHiddenStatusId,
} from './kanbanPreferences';

describe('projectKanbanHiddenStatusesKey', () => {
  it('builds a per-project setting name from the shared prefix', () => {
    expect(projectKanbanHiddenStatusesKey('proj-1')).toBe(
      `${PROJECT_KANBAN_HIDDEN_STATUSES_SETTING}:proj-1`
    );
  });
});

describe('getKanbanStatusIdentity', () => {
  it('uses standard_status_id for standard statuses', () => {
    expect(
      getKanbanStatusIdentity({ is_standard: true, standard_status_id: 'std-1', status_id: 'cus-1' })
    ).toBe('std-1');
  });

  it('uses status_id for custom statuses', () => {
    expect(
      getKanbanStatusIdentity({ is_standard: false, standard_status_id: 'std-1', status_id: 'cus-1' })
    ).toBe('cus-1');
  });

  it('falls back to status_id when a standard status has no standard_status_id', () => {
    expect(
      getKanbanStatusIdentity({ is_standard: true, standard_status_id: undefined, status_id: 'cus-1' })
    ).toBe('cus-1');
  });

  it('gives the same identity to the same standard status across phases (different mappings)', () => {
    const inPhaseA = { is_standard: true, standard_status_id: 'std-1', status_id: 'map-a' };
    const inPhaseB = { is_standard: true, standard_status_id: 'std-1', status_id: 'map-b' };
    expect(getKanbanStatusIdentity(inPhaseA)).toBe(getKanbanStatusIdentity(inPhaseB));
  });
});

describe('normalizeHiddenStatusIds', () => {
  it('passes through a flat string array', () => {
    expect(normalizeHiddenStatusIds(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('drops non-string entries', () => {
    expect(normalizeHiddenStatusIds(['a', 1, null, undefined, {}, 'b'])).toEqual(['a', 'b']);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an object map', { 'phase-1': ['a'] }],
    ['a string', 'a'],
  ])('returns [] for %s', (_label, raw) => {
    expect(normalizeHiddenStatusIds(raw)).toEqual([]);
  });
});

describe('toggleHiddenStatusId', () => {
  it('adds an identity that is not hidden yet', () => {
    expect(toggleHiddenStatusId(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('removes an identity that is already hidden', () => {
    expect(toggleHiddenStatusId(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('does not mutate the input array', () => {
    const input = ['a'];
    toggleHiddenStatusId(input, 'b');
    toggleHiddenStatusId(input, 'a');
    expect(input).toEqual(['a']);
  });

  it('treats a malformed stored value as empty before toggling', () => {
    expect(toggleHiddenStatusId({ 'phase-1': ['a'] }, 'b')).toEqual(['b']);
  });
});
