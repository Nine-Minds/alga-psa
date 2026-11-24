import type { Knex } from 'knex';
import { getUserWithRoles } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import { assertProjectReadAllowed } from '@alga-psa/projects/lib/projectReadAuthorization';

function isProjectAccessDenied(error: unknown): boolean {
  return error instanceof Error && (
    error.message.startsWith('Permission denied') || error.message === 'Project not found'
  );
}

/**
 * Admit task-comment notification recipients using the same project record
 * decision as task-comment reads, in addition to the coarse task permission.
 */
// LEVERAGE: pattern notification-recipient-record-admission — ticket and project notifications each resolve recipient RBAC plus a record-read decision.
export async function filterRecipientsWhoCanReadProject(
  db: Knex | Knex.Transaction,
  tenant: string,
  projectId: string,
  userIds: string[],
): Promise<string[]> {
  const allowed: string[] = [];
  for (const userId of [...new Set(userIds)]) {
    try {
      const user = await getUserWithRoles(userId, tenant);
      if (!user) continue;
      if (!(await hasPermission(user, 'project_task', 'read', db))) continue;
      await assertProjectReadAllowed(db, tenant, user, projectId);
      allowed.push(userId);
    } catch (error) {
      // Keep database and other unexpected failures visible to the subscriber.
      if (!isProjectAccessDenied(error)) throw error;
    }
  }
  return allowed;
}
