/**
 * Exact-name auto-matching between Huntress organizations and Alga clients.
 * Only unambiguous, exact normalized matches auto-link; anything weaker is
 * left for the user to map manually.
 */

export function normalizeOrgName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['''`]/g, '')          // drop apostrophes/quotes (O'Brien → obrien)
    .replace(/[^a-z0-9\s]+/g, ' ')  // remaining punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

export function findExactNameMatch(
  orgName: string,
  clients: Array<{ client_id: string; client_name: string }>
): string | null {
  const target = normalizeOrgName(orgName);
  if (!target) return null;

  const matches = clients.filter((c) => normalizeOrgName(c.client_name) === target);
  return matches.length === 1 ? matches[0].client_id : null;
}
