/**
 * Ticket alga-2026-0003292 for the REST API service layer.
 *
 * UserService.ts cannot be imported at runtime (its `../controllers/types` and
 * `../schemas/userSchemas` live in server/, which is why every suite for this
 * file is contract-style). So the wiring is asserted on the source: each write
 * that can empty a role set, or drop the tenant's last active MSP Admin, calls
 * the shared guard before its write, and user creation requires a role.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'UserService.ts'), 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('user service role floor contract', () => {
  it('reports a last-role refusal as 400 and a last-admin refusal as 409', () => {
    expect(source).toContain("import type { UserRoleFloorChange, UserRoleFloorViolation } from '@alga-psa/db'");
    const helper = sectionBetween('function throwOnUserRoleFloor', 'async function enforceUserRoleFloor');
    expect(helper).toContain("violation === 'last_msp_admin'");
    expect(helper).toContain('throw new ConflictError(message)');
    expect(helper).toContain('throw new ValidationError(message)');
  });

  it('guards role assignment on the final role set, before the delete', () => {
    const section = sectionBetween('async assignRoles', 'Remove roles from user');
    const guard = section.indexOf("enforceUserRoleFloor(trx, context.tenant, { kind: 'set_roles', userId, roleIds })");
    const del = section.indexOf('.del()');

    expect(guard).toBeGreaterThan(0);
    expect(del).toBeGreaterThan(guard);
  });

  it('guards role removal, and checks the user exists first', () => {
    const section = sectionBetween('async removeRoles', 'TEAM MEMBERSHIPS');

    expect(section).toContain("throw new NotFoundError('User not found')");
    const guard = section.indexOf("enforceUserRoleFloor(trx, context.tenant, { kind: 'remove_roles', userId, roleIds })");
    const del = section.indexOf('.del()');

    expect(guard).toBeGreaterThan(0);
    expect(del).toBeGreaterThan(guard);
  });

  it('guards the update that gives up an active internal seat', () => {
    const section = sectionBetween('async update(id: string', 'Delete user with proper cleanup');

    expect(section).toContain('occupiesSeatNow && !occupiesSeatAfter');
    expect(section).toContain("enforceUserRoleFloor(trx, context.tenant, { kind: 'deactivate_user', userId: id })");
  });

  it('guards deletion before any cleanup runs', () => {
    const section = sectionBetween('async delete(id: string', 'Delete related data');

    expect(section).toContain("enforceUserRoleFloor(trx, context.tenant, { kind: 'delete_user', userId: id })");
  });

  it('guards bulk deactivation over the whole target set', () => {
    const section = sectionBetween('async bulkDeactivateUsers', 'ANALYTICS & REPORTING');

    expect(section).toContain("{ kind: 'deactivate_user', userId: targetId }");
    expect(section).toContain('alsoAffectedUserIds: targetIds.filter((other) => other !== targetId)');
  });

  it('refuses to create a user with no role', () => {
    const section = sectionBetween('private async createUsingTransaction', 'Update user with comprehensive validation');

    expect(section).toContain('!data.role_ids || data.role_ids.length === 0');
    expect(section).toContain("throw new ValidationError('At least one role is required')");
  });
});
