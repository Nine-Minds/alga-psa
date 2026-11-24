/**
 * Who may write a tag, decided by the kernel and not by a role name.
 *
 * Three questions, each neutral (answered "allowed" before any rule is read) for everyone a built-in rule resolver
 * does not govern, so ordinary MSP tagging is unchanged:
 *
 *  - may the caller write THE RECORD being tagged (`assertTagTargetWritable`): a seat technician works a ticket on
 *    an in-scope board or a task of a shared project, and RBAC alone (`ticket:update`, `project_task:update`) does
 *    not say which;
 *  - may the caller use THIS tag (`isTagDefinitionVisible`): the tag read scope, the same one the picker's list is
 *    narrowed by, applied to the definition the server is about to map;
 *  - may the caller manage tag DEFINITIONS (`isTagDefinitionManagementRestricted`): the resolver's closed baseline
 *    grants a seat `tag:read` only, so renaming, recoloring and deleting a definition is closed to it whatever its
 *    role holds, exactly as creating one is (`tagCreationRestriction`).
 *
 * Applying or removing a MAPPING is a write on the record, not on the definition: that is why the first question
 * is the record's and the third is not asked for it.
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IUserWithRoles, TaggedEntityType } from '@alga-psa/types';
import {
  assertWorkItemParentAllowed,
  isParentResourceDeniedError,
  isResolverGovernedActionAllowed,
  isResolverGovernedUser,
} from '@alga-psa/authorization/recordCreateAuthorization';
import { authorizeTicketRecordAccess } from '@alga-psa/authorization/ticketRecordAuthorization';
import { resolveTagReadScope } from './tagReadScope';

export const TAG_DEFINITION_MANAGEMENT_RESTRICTED_MESSAGE = 'Permission denied: Tag definitions are managed by the MSP';

/** Whether a resolver's closed baseline bars the caller from `action` (update / delete) on tag definitions. */
export async function isTagDefinitionManagementRestricted(
  db: Knex | Knex.Transaction,
  input: { tenant: string; user: IUserWithRoles },
  action: 'update' | 'delete',
): Promise<boolean> {
  return !await isResolverGovernedActionAllowed(db, { ...input, resourceType: 'tag', action });
}

export async function assertTagDefinitionManagementAllowed(
  db: Knex | Knex.Transaction,
  input: { tenant: string; user: IUserWithRoles },
  action: 'update' | 'delete',
): Promise<void> {
  if (await isTagDefinitionManagementRestricted(db, input, action)) {
    throw new Error(TAG_DEFINITION_MANAGEMENT_RESTRICTED_MESSAGE);
  }
}

function isRecordDenial(error: unknown): boolean {
  if (isParentResourceDeniedError(error)) return true;
  return error instanceof Error && (error.message.startsWith('Permission denied') || error.message === 'Ticket not found');
}

/**
 * For a caller a resolver governs (a seat technician): resolves `true` when it may write the record a tag is mapped
 * to and throws `Permission denied` when it may not. Resolves `false` for everyone else, whose RBAC decision stands.
 * A ticket is decided by its own record authorization; a project task by the parent project it is governed through
 * (a seat technician's shared projects). Any other kind has no record path a governed caller is granted: refused.
 */
export async function assertTagTargetWritable(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  taggedType: TaggedEntityType,
  taggedId: string,
): Promise<boolean> {
  if (!await isResolverGovernedUser(trx, { tenant, user })) return false;
  try {
    if (taggedType === 'ticket') {
      await authorizeTicketRecordAccess({ trx, tenant, user, ticketId: taggedId, action: 'update' });
      return true;
    }
    if (taggedType === 'project_task') {
      await assertWorkItemParentAllowed(trx, {
        tenant, user, resolver: 'tagged_entity', discriminator: taggedType, id: taggedId,
      }, 'tags');
      return true;
    }
  } catch (error) {
    if (!isRecordDenial(error)) throw error;
  }
  throw new Error(`Permission denied: You don't have permission to update this ${taggedType.replace('_', ' ')}`);
}

/**
 * Whether the caller may use the tag definition: always, unless the caller's read scope is narrowed (a seat
 * technician), in which case only a definition one of whose mappings is on a record in scope.
 */
export async function isTagDefinitionVisible(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  definitionId: string,
): Promise<boolean> {
  const scope = await resolveTagReadScope(trx, tenant, user);
  if (!scope) return true;
  const row = await tenantDb(trx, tenant).table('tag_definitions as td')
    .where('td.tag_id', definitionId)
    .modify((query: Knex.QueryBuilder) => scope.applyToDefinitions(query, 'td'))
    .first('td.tag_id');
  return Boolean(row);
}
