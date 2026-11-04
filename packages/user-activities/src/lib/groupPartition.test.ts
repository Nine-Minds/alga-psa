import { describe, expect, it } from 'vitest';
import { partitionActivitiesByGroup, resolveActivityGroup } from './groupPartition';

const act = (id: string, type = 'ticket') => ({ id, type });
const grp = (
  groupId: string,
  items: Array<[string, string]>,
  isDefault = false,
) => ({
  groupId,
  isDefault,
  items: items.map(([activityId, activityType]) => ({ activityId, activityType })),
});

describe('partitionActivitiesByGroup', () => {
  it('without a default, unmembered activities go to ungrouped', () => {
    const acts = [act('a'), act('b'), act('loose')];
    const r = partitionActivitiesByGroup(acts, [grp('g1', [['a', 'ticket']]), grp('g2', [['b', 'ticket']])]);
    expect(r.groups.map((g) => g.activities.map((a) => a.id))).toEqual([['a'], ['b']]);
    expect(r.ungrouped.map((a) => a.id)).toEqual(['loose']);
    expect(r.groups.map((g) => g.pinnedCount)).toEqual([1, 1]);
  });

  it('with a default, unmembered activities go first in the default group and ungrouped is empty', () => {
    const acts = [act('n1'), act('p'), act('n2')];
    const r = partitionActivitiesByGroup(acts, [
      grp('g1', []),
      grp('inbox', [['p', 'ticket']], true),
    ]);
    expect(r.groups[1].activities.map((a) => a.id)).toEqual(['n1', 'n2', 'p']);
    expect(r.groups[1].pinnedCount).toBe(1);
    expect(r.groups[0].activities).toEqual([]);
    expect(r.ungrouped).toEqual([]);
  });

  it('an item pinned in group X stays in X when another group is the default', () => {
    const acts = [act('a'), act('loose')];
    const r = partitionActivitiesByGroup(acts, [
      grp('x', [['a', 'ticket']]),
      grp('inbox', [], true),
    ]);
    expect(r.groups[0].activities.map((a) => a.id)).toEqual(['a']);
    expect(r.groups[1].activities.map((a) => a.id)).toEqual(['loose']);
  });

  it('skips memberships whose activity is not in view and matches on type + id', () => {
    const acts = [act('a'), act('a', 'projectTask')];
    const r = partitionActivitiesByGroup(acts, [
      grp('g1', [['ghost', 'ticket'], ['a', 'ticket']]),
    ]);
    expect(r.groups[0].activities).toEqual([acts[0]]);
    expect(r.ungrouped).toEqual([acts[1]]);
  });
});

describe('resolveActivityGroup', () => {
  it('returns pinned group, else default, else null', () => {
    const groups = [grp('x', [['a', 'ticket']]), grp('inbox', [], true)];
    expect(resolveActivityGroup(act('a'), groups)).toMatchObject({ pinned: true, group: { groupId: 'x' } });
    expect(resolveActivityGroup(act('b'), groups)).toMatchObject({ pinned: false, group: { groupId: 'inbox' } });
    expect(resolveActivityGroup(act('b'), [grp('x', [])])).toBeNull();
  });
});
