import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readControllerSource(): string {
  const filePath = path.resolve(__dirname, '../../../lib/api/controllers/ApiTimeSheetController.ts');
  return fs.readFileSync(filePath, 'utf8');
}

function readServiceSource(): string {
  const filePath = path.resolve(__dirname, '../../../lib/api/services/TimeSheetService.ts');
  return fs.readFileSync(filePath, 'utf8');
}

describe('Schedule endpoints authorization parity contract', () => {
  it('checks user_schedule instead of the unseeded schedule resource', () => {
    const source = readControllerSource();

    expect(source).not.toMatch(/hasPermission\(\s*user,\s*'schedule'/);
    expect(source).toContain("'user_schedule',");
  });

  it('scopes schedule reads through the shared-calendar resolver', () => {
    const source = readServiceSource();

    expect(source).toContain('resolveCalendarAccess(');
    expect(source).toContain('buildVisibilityFilter(access)');
    expect(source).toContain('evaluateEntryAccess(');
    expect(source).toContain('maskApiScheduleEntry(');
  });

  it('rejects assigning other users on create unless calendar access allows it (canAssignUser)', () => {
    const source = readControllerSource();

    expect(source).toContain('canAssignUser(');
    expect(source).toContain('Permission denied: Cannot assign schedules to other users');
  });

  it('guards single-entry update/delete via the shared-calendar access rule (getScheduleEntryForAccess + evaluateEntryAccess)', () => {
    const source = readControllerSource();

    expect(source).toContain('getScheduleEntryForAccess(');
    expect(source).toContain('evaluateEntryAccess(');
    expect(source).toContain('canAssignUser(');
    expect(source).toContain('existing.is_private &&');
  });

  it('enforces user_schedule RBAC in the service helpers', () => {
    const source = readServiceSource();

    expect(source).toContain("hasPermission(context.user, 'user_schedule', 'update', knex)");
    expect(source).toContain("hasPermission(context.user, 'user_schedule', action, knex)");
    expect(source).not.toMatch(/canViewAllSchedules[\s\S]{0,120}Simplified for now/);
  });
});
