import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { productionSourceFiles } from '../../../../scripts/lib/production-source-files.mjs';

/**
 * Coverage ledger for every `user_roles` write path (alga-2026-0003347).
 *
 * `contacts.is_client_admin` is a mirror of the client portal 'Admin' role, and
 * the portal visibility resolver widens a portal user's ticket/asset/project
 * scope to the whole client on it — so a role write that does not re-derive the
 * flag can leave a portal user reading their colleagues' tickets. The first fix
 * put the sync in five server actions by hand, and the ten writers that did not
 * repeat the line (the REST API among them) kept drifting.
 *
 * So every writer is listed here: it either goes through the shared writes in
 * userRoleWrites.ts (the marker proves it) or is exempt with the reason. A new
 * writer in neither list fails the completeness test.
 */
const root = path.resolve(__dirname, '../../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

/** The module that owns the statements; every other writer calls into it. */
const WRITE_OWNER = 'packages/db/src/lib/userRoleWrites.ts';

const SYNC_MARKERS = ['setUserRoles', 'addUserRoles', 'removeUserRoles', 'syncContactClientAdminFlag'];

/**
 * Writers that re-derive the flag because they write through the shared
 * helpers. Listed by the helper they use, so dropping the call back to a raw
 * insert/delete is a failing test and not a silent regression.
 */
const SYNCED_WRITERS: Record<string, string> = {
  'packages/auth/src/actions/policyActions.ts': 'addUserRoles',
  'packages/auth/src/lib/registrationHelpers.ts': 'addUserRoles',
  'packages/db/src/models/user.ts': 'setUserRoles',
  'packages/portal-shared/src/actions/portalInvitationActions.ts': 'addUserRoles',
  'packages/users/src/actions/user-actions/registrationActions.ts': 'addUserRoles',
  'packages/users/src/actions/user-actions/userActions.ts': 'setUserRoles',
  'packages/users/src/lib/roleActions.ts': 'removeUserRoles',
  'packages/users/src/services/UserService.ts': 'setUserRoles',
  'server/src/lib/api/controllers/ApiUserController.ts': 'setUserRoles',
  'server/src/lib/api/services/PermissionRoleService.ts': 'setUserRoles',
  'shared/models/userModel.ts': 'addUserRoles',
  'ee/server/src/lib/integrations/entra/sync/clientPortalProvisioning.ts': 'addUserRoles',
  'ee/server/src/lib/integrations/entra/sync/workflowPortalAccessActions.ts': 'addUserRoles',
  'ee/server/src/lib/co-managed/portableWorkspaceRestoreDatabase.ts': 'syncContactClientAdminFlag',
};

/**
 * Writers for which the sync is a no-op by design. The flag only exists for a
 * portal user (`users.user_type = 'client'`) linked to a contact; everything
 * here either writes roles for another kind of user or removes the user row
 * altogether, which returns the contact's flag to the invitation pre-seed it
 * started as.
 */
const EXEMPT_WRITERS: Record<string, string> = {
  'packages/co-managed/src/seatInvitation.ts':
    'assigns the co-managed seat role to an internal (seat technician) user in the sponsor tenant; internal users have no contact and therefore no flag',
  'packages/co-managed/src/seatRevocation.ts':
    'revokes or restores the seat role of an internal seat technician; internal users have no contact and therefore no flag',
  'ee/server/src/lib/co-managed/portableWorkspaceActivation.ts':
    'grants the administrator role to the internal administrator user of a newly activated workspace; internal users have no contact',
  'ee/server/src/lib/service-principals/service.ts':
    "writes roles for service principals (users.user_type 'service'), which have no contact and no portal scope",
  'ee/server/src/lib/actions/service-principal-actions.ts':
    "replaces the roles of a service principal (users.user_type 'service'), which has no contact and no portal scope",
  'ee/server/src/lib/testing/tenant-creation.ts':
    'seeds the first MSP Admin user of a brand-new tenant; an internal user with no contact',
  'ee/temporal-workflows/src/db/product-upgrade-operations.ts':
    'back-fills the MSP Technician role for MSP Agent users during a product upgrade; both roles are msp-scoped, so no portal user is involved',
  'ee/temporal-workflows/src/db/portal-user-operations.ts':
    'rolls a failed portal-user creation back by deleting the user_roles rows together with the users row, which returns the contact flag to its pre-seed meaning',
  'ee/temporal-workflows/src/db/user-operations.ts':
    'deletes a user and its role rows; with the portal user gone the contact flag is the invitation pre-seed again',
  'ee/temporal-workflows/src/db/tenant-operations.ts':
    'tenant deletion removes every row of the tenant, contacts included',
  'ee/temporal-workflows/src/activities/tenant-deletion-activities.ts':
    'the dynamic tenant deletion manifest removes user_roles together with all tenant rows, contacts included',
};

/**
 * Manifest-driven writers have no literal table name at their write statement.
 * Keep their entry points in the inventory explicitly, with a write marker so
 * changing the dynamic implementation requires reviewing this classification.
 * Restore is synced after ALL tables and deferred links have been written;
 * tenant deletion is exempt because it removes the contacts as well.
 */
const DYNAMIC_WRITERS: Record<string, string> = {
  'ee/server/src/lib/co-managed/portableWorkspaceRestoreDatabase.ts': 'own.table(table).insert(',
  'ee/temporal-workflows/src/activities/tenant-deletion-activities.ts': 'explicitTenantDeletionTableQuery(k, tenantId, tableBoundary).delete()',
};

/**
 * Synced writers that additionally delete role rows as part of deleting the
 * user. No sync is owed: with the portal user gone the contact's flag is the
 * invitation pre-seed again, which is what the portal reads it as.
 */
const ROW_REMOVAL_WRITERS: Record<string, string> = {
  'packages/users/src/actions/user-actions/userActions.ts':
    "deleteUser's cascade drops the user's user_roles rows along with the users row; the role change paths in the same file go through setUserRoles/addUserRoles",
  'packages/users/src/services/UserService.ts':
    "delete() clears the user's user_roles rows before deleting the users row; assignRoles/removeRoles in the same file go through setUserRoles/removeUserRoles",
};

const WRITE_VERB = /\.(insert|update|del|delete|upsert|truncate)\(/;
const RAW_WRITE = /(insert\s+into|update|delete\s+from)\s+user_roles\b/i;

/**
 * Files that write `user_roles`: a quoted table name with a write verb in the
 * statement that follows it, or raw SQL naming the table in a write. Line
 * comments are stripped first so prose about a delete does not count as one.
 */
function writersOfUserRoles(): string[] {
  const files = productionSourceFiles(root, [
    'packages',
    'server/src',
    'shared',
    'ee/server/src',
    'ee/packages',
    'ee/temporal-workflows/src',
  ]).filter((file: string) => !/(^|\/)(migrations|seeds)\//.test(file));

  const writers: string[] = [];
  for (const file of files) {
    const lines = read(file)
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''));
    const writes = lines.some(
      (line, i) =>
        (/['"`]user_roles['"`]/.test(line) && WRITE_VERB.test(lines.slice(i, i + 9).join(' '))) ||
        RAW_WRITE.test(line)
    );
    if (writes || file in DYNAMIC_WRITERS) writers.push(file);
  }
  return writers.sort();
}

describe('user_roles writer classification', () => {
  const writers = writersOfUserRoles();

  it('finds the known writers (guards the scanner itself)', () => {
    expect(writers).toContain(WRITE_OWNER);
    expect(writers).toContain('packages/co-managed/src/seatInvitation.ts');
    expect(writers).toContain('ee/server/src/lib/service-principals/service.ts');
    expect(writers).toContain('ee/server/src/lib/co-managed/portableWorkspaceRestoreDatabase.ts');
    expect(writers).toContain('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts');
  });

  it.each(Object.entries(DYNAMIC_WRITERS))('%s keeps its manifest-driven write classified', (file, marker) => {
    expect(writers).toContain(file);
    expect(read(file)).toContain(marker);
    expect(WRITE_VERB.test(read(file))).toBe(true);
    expect(file in SYNCED_WRITERS || file in EXEMPT_WRITERS).toBe(true);
  });

  it('every writer carries the flag sync or is classified as exempt', () => {
    const unclassified = writers.filter(
      (file) => file !== WRITE_OWNER && !(file in SYNCED_WRITERS) && !(file in EXEMPT_WRITERS)
    );
    expect(unclassified).toEqual([]);
  });

  it.each(Object.entries(SYNCED_WRITERS))('%s writes through the shared role write (%s)', (file, marker) => {
    const source = read(file);
    expect(source).toContain(marker);
    // The shared write is the only way to touch user_roles from here: no
    // hand-rolled insert/delete alongside it, which is how the flag drifted.
    expect(SYNC_MARKERS.some((candidate) => source.includes(candidate))).toBe(true);
  });

  it.each(Object.entries(EXEMPT_WRITERS))('%s is exempt: %s', (_file, reason) => {
    expect(reason.length).toBeGreaterThan(20);
  });

  it('keeps the role statements in one place: a synced writer adds no raw role write of its own', () => {
    // A synced writer may still READ user_roles, and may delete its rows as
    // part of removing the user — what it may not do is hand-roll a role
    // change, which is how the flag drifted in the first place.
    const unexpected = writers.filter((file) => {
      if (file === WRITE_OWNER || !(file in SYNCED_WRITERS) || file in ROW_REMOVAL_WRITERS) return false;
      const lines = read(file)
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, ''));
      return lines.some(
        (line, i) =>
          /['"`]user_roles['"`]/.test(line) &&
          /\.(insert|del|delete|upsert|truncate)\(/.test(lines.slice(i, i + 9).join(' '))
      );
    });
    expect(unexpected).toEqual([]);
  });

  it.each(Object.entries(ROW_REMOVAL_WRITERS))('%s deletes role rows with the user: %s', (_file, reason) => {
    expect(reason.length).toBeGreaterThan(20);
  });
});

// Role definitions are another input to the flag, even without membership writes.
describe('role-definition writer classification', () => {
  it('classifies every role update and keeps synchronization on both live writers', () => {
    const writers = productionSourceFiles(root, ['packages', 'server/src', 'shared', 'ee/server/src', 'ee/packages', 'ee/temporal-workflows/src'])
      .filter((file: string) => !/(^|\/)(migrations|seeds)\//.test(file))
      .filter((file: string) => {
        const lines = read(file).split('\n').map((line) => line.replace(/\/\/.*$/, ''));
        return lines.some((line, i) => /['"`]roles['"`]/.test(line) && /\.update\(/.test(lines.slice(i, i + 9).join(' ')));
      });
    const synced = ['packages/auth/src/actions/policyActions.ts', 'server/src/lib/api/services/PermissionRoleService.ts'];
    // Scanner lookahead sees a USERS update after a roles read; activation
    // grants an internal administrator role and never changes its definition.
    const exempt = ['ee/server/src/lib/co-managed/portableWorkspaceActivation.ts'];
    expect(writers.filter((file: string) => !synced.includes(file) && !exempt.includes(file))).toEqual([]);
    for (const file of synced) {
      expect(writers).toContain(file);
      expect(read(file)).toContain('await lockClientPortalMutations(');
      expect(read(file)).toContain('await syncContactClientAdminFlagsForRole(');
    }
  });
});
