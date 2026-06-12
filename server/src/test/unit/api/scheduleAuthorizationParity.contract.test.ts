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

  it('scopes list to the requesting user without user_schedule:update', () => {
    const source = readControllerSource();

    expect(source).toContain('user_id: canViewAllSchedules');
    expect(source).toContain(': user.user_id');
  });

  it('requires user_schedule:update to assign entries to other users on create', () => {
    const source = readControllerSource();

    expect(source).toContain('Permission denied: Cannot assign schedules to other users');
  });

  it('guards single-entry get/update/delete by ownership for non-update users', () => {
    const source = readControllerSource();

    expect(source).toContain('Permission denied: Cannot read schedules of other users');
    expect(source).toContain('const canUpdateAll = await hasPermission(');
    expect(source).toContain('const canDeleteAll = await hasPermission(');
    expect(source).toContain('const isOwnEntry = existing.created_by === user.user_id ||');
  });

  it('enforces user_schedule RBAC in the service helpers', () => {
    const source = readServiceSource();

    expect(source).toContain("hasPermission(context.user, 'user_schedule', 'update', knex)");
    expect(source).toContain("hasPermission(context.user, 'user_schedule', action, knex)");
    expect(source).not.toMatch(/canViewAllSchedules[\s\S]{0,120}Simplified for now/);
  });
});
