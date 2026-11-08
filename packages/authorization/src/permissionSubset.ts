/**
 * Whether every permission key in `requested` is present in the actor's
 * effective permission set. Empty requested sets are subsets by definition.
 */
export function isPermissionSubset(
  requested: Iterable<string>,
  actorPermissions: ReadonlySet<string>,
): boolean {
  for (const permission of requested) {
    if (!actorPermissions.has(permission)) return false;
  }
  return true;
}
