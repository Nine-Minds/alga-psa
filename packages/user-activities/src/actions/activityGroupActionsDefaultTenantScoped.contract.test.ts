import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Source-level contract (same pattern as the other activityGroupActions*TenantScoped tests):
// default-group logic lives in the identity-explicit core; the withAuth wrapper delegates.
const coreSource = readFileSync(resolve(__dirname, 'activityGroupCore.ts'), 'utf8');
const actionsSource = readFileSync(resolve(__dirname, 'activityGroupActions.ts'), 'utf8');
const indexSource = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
const serverEntrySource = readFileSync(resolve(__dirname, '../server/activity-actions.ts'), 'utf8');

function sectionFrom(source: string, startMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start);
}

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const section = sectionFrom(source, startMarker);
  const end = section.indexOf(endMarker, startMarker.length);
  return end === -1 ? section : section.slice(0, end);
}

describe('default activity group contract', () => {
  const setDefault = sectionBetween(
    coreSource,
    'export async function setDefaultActivityGroupForApi',
    '\nexport ',
  );

  it('1. sets is_default on the chosen group only, and reads expose isDefault', () => {
    expect(setDefault).toContain('.update({ is_default: true');
    expect(setDefault).toMatch(/\.where\(\{ group_id: groupId, user_id: user\.user_id \}\)\s*\.update\(\{ is_default: true/);
    expect(coreSource).toContain('"is_default"');
    expect(coreSource).toContain('isDefault: g.is_default');
    expect(actionsSource).toContain('isDefault: false');
  });

  it('2. switching clears the caller\'s current default first, in one transaction; null clears all', () => {
    expect(setDefault).toContain('withTransaction');
    const clearIdx = setDefault.indexOf('.update({ is_default: false');
    const setIdx = setDefault.indexOf('.update({ is_default: true');
    expect(clearIdx).toBeGreaterThan(-1);
    expect(setIdx).toBeGreaterThan(clearIdx);
    expect(setDefault).toMatch(/if \(groupId\) \{\s*await scopedDb\.table\("user_activity_groups"\)\s*\.where\(\{ group_id: groupId/);
    expect(setDefault).toContain('groupId: string | null');
  });

  it('3. a missing or foreign group throws "Group not found", scoped by user_id', () => {
    expect(setDefault).toContain('user_id: user.user_id');
    expect(setDefault).toContain('throw new Error("Group not found")');
    // The existence check happens before any write, so a foreign id never clears the default.
    expect(setDefault.indexOf('Group not found')).toBeLessThan(setDefault.indexOf('.update('));
    expect(setDefault).not.toContain('targetUserId');
  });

  it('4. deleting the default group removes the row (and so the flag); no extra default is assigned', () => {
    const del = sectionFrom(actionsSource, 'export const deleteActivityGroup');
    const delBody = del.slice(0, del.indexOf('export const moveActivityToGroup'));
    expect(delBody).toContain(".table('user_activity_groups').where({ group_id: groupId }).del()");
    expect(delBody).not.toContain('is_default');
  });

  it('5. is gated by assertCanOrganizeGroups', () => {
    expect(setDefault).toContain('await assertCanOrganizeGroups(trx, user)');
    expect(coreSource).toContain('Permission denied: cannot organize activity groups');
  });

  it('6. reorder upserts, removing the activity from the caller\'s other groups first', () => {
    const reorder = sectionBetween(coreSource, 'export async function reorderActivitiesInGroupForApi', '\nexport ');
    expect(reorder).toContain('.whereNot({ group_id: groupId })');
    expect(reorder).toContain('.whereIn("group_id", otherGroupIds)');
    expect(reorder.indexOf('.del()')).toBeLessThan(reorder.indexOf('.insert('));
    expect(reorder).toContain('.onConflict(["tenant", "group_id", "activity_id", "activity_type"])');
    expect(reorder).toContain('.merge(["sort_order"])');
  });

  it('7. every query is structurally tenant-scoped (no bare knex table access)', () => {
    expect(setDefault).toContain('tenantDb(trx, tenant)');
    expect(setDefault).not.toMatch(/trx\(\s*["']user_activity_groups["']\s*\)/);
    const reorder = sectionBetween(coreSource, 'export async function reorderActivitiesInGroupForApi', '\nexport ');
    expect(reorder).not.toMatch(/trx\(\s*["']user_activity_group/);
  });

  it('wires the withAuth wrapper and exports', () => {
    expect(actionsSource).toContain('export const setDefaultActivityGroup = withAuth');
    expect(actionsSource).toContain('setDefaultActivityGroupForApi(user, tenant, groupId)');
    // actions/index.ts re-exports the whole activityGroupActions module
    expect(indexSource).toContain("export * from './activityGroupActions'");
    expect(serverEntrySource).toContain('setDefaultActivityGroupForApi');
  });
});
