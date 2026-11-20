import type { Knex } from 'knex';
import type { IUserWithRoles, ItemType, TaggedEntityType } from '@alga-psa/types';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  REFERENCE_LIST_KEYS,
  referenceListError,
  type ReferenceListKey,
} from '@alga-psa/ui/lib/referenceData';
// These are the un-wrapped bodies of the existing list actions (getAllBoards, getStatuses,
// getAllPriorities, findAllTagsByType, getProjectsWithPhases). The actions call the very same
// functions, so each key returns what the matching action returns for the same user.
// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- composition layer is the one place allowed to join these packages
import { loadBoards, loadPriorities, loadStatuses } from '@alga-psa/reference-data/lib/referenceListQueries';
import { loadTagsByType } from '@alga-psa/tags/lib/tagListQueries';
import { loadProjectsWithPhases } from '@alga-psa/projects/lib/projectsWithPhases';

type Loader = (db: Knex, tenant: string, user: IUserWithRoles) => Promise<unknown>;

const LOADERS: Record<ReferenceListKey, Loader> = {
  // The activities page asks for every board, active or not: getAllBoards(true).
  boards: (db, tenant) => loadBoards(db, tenant, true),
  ticketStatuses: (db, tenant) => loadStatuses(db, tenant, 'ticket' as ItemType),
  ticketTags: (db, tenant, user) => loadTagsByType(db, tenant, user, 'ticket' as TaggedEntityType),
  projectTaskTags: (db, tenant, user) => loadTagsByType(db, tenant, user, 'project_task' as TaggedEntityType),
  projectsWithPhases: async (db, tenant, user) => {
    const projects = await loadProjectsWithPhases(db, tenant, user);
    // A project:read denial is an error for this key only, never an empty list: the same denial the
    // action reports, so the user never receives more (or a different) list than the action gives.
    if (isActionPermissionError(projects)) throw new Error(projects.permissionError ?? 'Permission denied');
    return projects;
  },
  'priorities:ticket': (db, tenant) => loadPriorities(db, tenant, 'ticket'),
  'priorities:project_task': (db, tenant) => loadPriorities(db, tenant, 'project_task'),
};

/**
 * Runs the requested list loaders in parallel for an already-authenticated user. A key that fails
 * (permission denial, query error) is returned as an error marker; the others are unaffected.
 */
export async function loadReferenceListsFor(
  db: Knex,
  tenant: string,
  user: IUserWithRoles,
  keys: readonly ReferenceListKey[]
): Promise<Partial<Record<ReferenceListKey, unknown>>> {
  const unique = Array.from(new Set(keys));
  const entries = await Promise.all(
    unique.map(async (key): Promise<[ReferenceListKey, unknown]> => {
      const loader = (REFERENCE_LIST_KEYS as readonly string[]).includes(key) ? LOADERS[key] : undefined;
      if (!loader) return [key, referenceListError(`Unknown reference list: ${String(key)}`)];
      try {
        return [key, await loader(db, tenant, user)];
      } catch (error) {
        console.error(`[loadReferenceLists] ${key} failed:`, error);
        return [key, referenceListError(error instanceof Error ? error.message : 'Failed to load')];
      }
    })
  );
  return Object.fromEntries(entries);
}
