/**
 * Who may mint a new tag definition. A seat technician applies existing tags and cannot create one.
 *
 * The restriction is not a role check made here: it is the seat authority's closed baseline, which grants a seat
 * subject `tag:read` and no other tag action, asked through the kernel's create authorization
 * (`isResolverGovernedCreateAllowed`). Role permissions alone do not close it, because the seat role holds
 * `tag:create` for the sake of its existing-tag picker. Everyone the baseline does not govern is answered
 * `true` before any rule is read, so tag behaviour for them is exactly what it was.
 */
import type { Knex } from 'knex';
import { isResolverGovernedCreateAllowed } from '@alga-psa/authorization/recordCreateAuthorization';
import type { SubjectUserInput } from '@alga-psa/authorization/subject';

/** Why a governed caller is refused. */
export const TAG_CREATION_RESTRICTED_MESSAGE = 'You can only apply tags that already exist.';
export const TAG_CREATION_RESTRICTED_KEY = 'common:errors.tags.creationRestricted';

/** Whether a built-in resolver (seat authority) bars the caller from creating tag definitions. */
export async function isTagCreationRestricted(
  db: Knex | Knex.Transaction,
  input: { tenant: string; user: SubjectUserInput },
): Promise<boolean> {
  return !await isResolverGovernedCreateAllowed(db, { ...input, resourceType: 'tag' });
}
