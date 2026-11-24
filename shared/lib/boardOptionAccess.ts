import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';
import { isResolverGovernedUser } from '@alga-psa/authorization/recordCreateAuthorization';
import { resolveOperationBoardIds } from '@alga-psa/authorization/operationScope';

/**
 * The boards whose dependent options (statuses, categories) the caller may read: `null` when nothing restricts the
 * caller (no query change, at no statement beyond the cached tenant probe), otherwise the ticket read scope's boards.
 *
 * Statuses and categories are keyed by board, so the board decides them: a subject a built-in resolver governs
 * (a co-managed seat technician) is offered them only for a board its ticket read scope names, whichever form
 * asked, so a preselected board id in a request cannot reach another board's lists.
 */
export async function readableBoardIdsForOptions(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
): Promise<string[] | null> {
  if (!await isResolverGovernedUser(conn, { tenant, user })) return null;
  return (await resolveOperationBoardIds(conn, { tenant, user, action: 'read' })) ?? null;
}

export async function mayReadBoardOptions(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  boardId: string,
): Promise<boolean> {
  const readable = await readableBoardIdsForOptions(conn, tenant, user);
  return readable === null || readable.includes(boardId);
}
