import type { BadgeVariant } from '@alga-psa/ui/components/Badge';
import type { EntraConfirmedMapping } from '@alga-psa/integrations/actions';

// LEVERAGE: pattern entra-status-presentation — the console overview and the
// history tab each map a run status to a badge with their own ternary, and the
// three disagree. This is the third; the next surface to need one should take a
// shared presentation module instead.

/**
 * One answer to "what state is this client in", used by the badge, the filters
 * and the ordering.
 *
 * They used to be three separate expressions, and they disagreed. The badge
 * branched on `lastRunStatus === 'failed' | 'completed'` and called everything
 * else "Never synced" — so a client mid-run, and a client whose run partly
 * failed, both read as never having synced. The filters branched on a different
 * field again: "Never synced" tested `lastSyncedAt`, so a client could be
 * missing from the filter that its own badge claimed it belonged to. And
 * `partial` — which the notification rules count as a failure — appeared under
 * no filter at all, on the tab whose whole job is finding unhealthy clients.
 */
export type EntraClientHealth =
  | 'never'
  | 'running'
  | 'failed'
  | 'partial'
  | 'synced';

export const ENTRA_CLIENT_HEALTH_LABEL_KEYS: Record<EntraClientHealth, string> = {
  never: 'integrations.entra.console.clients.status.neverSynced',
  running: 'integrations.entra.console.clients.status.syncing',
  failed: 'integrations.entra.console.clients.status.failed',
  partial: 'integrations.entra.console.clients.status.partlyFailed',
  synced: 'integrations.entra.console.clients.status.synced',
};

// Typed as the kit's own union rather than `string`, which forced an `as never`
// at the one place that used it.
export const ENTRA_CLIENT_HEALTH_BADGE_VARIANTS: Record<EntraClientHealth, BadgeVariant> = {
  never: 'outline',
  running: 'default-muted',
  failed: 'error',
  // The backend's notification rules treat partial as a failure; amber says
  // "some of this client did not sync" without claiming the whole run died.
  partial: 'warning',
  synced: 'success',
};

export function entraClientHealth(mapping: EntraConfirmedMapping): EntraClientHealth {
  const status = (mapping.lastRunStatus || '').toLowerCase();

  if (status === 'failed') return 'failed';
  if (status === 'partial') return 'partial';
  if (status === 'running') return 'running';
  if (status === 'completed') return 'synced';

  // No run status and no sync timestamp is a client that has never run. An
  // unrecognised status with a timestamp is still a client that has synced.
  return mapping.lastSyncedAt ? 'synced' : 'never';
}

export type EntraClientFilter = 'all' | 'failing' | 'never-synced' | 'synced';

export const ENTRA_CLIENT_FILTERS: EntraClientFilter[] = [
  'all',
  'failing',
  'never-synced',
  'synced',
];

export function matchesEntraClientFilter(
  mapping: EntraConfirmedMapping,
  filter: EntraClientFilter
): boolean {
  const health = entraClientHealth(mapping);
  if (filter === 'failing') return health === 'failed' || health === 'partial';
  if (filter === 'never-synced') return health === 'never';
  if (filter === 'synced') return health === 'synced';
  return true;
}

/**
 * Worst first. The rows arrive alphabetically from the server, which at two
 * clients is invisible and at two hundred means the failing one is wherever the
 * alphabet put it — and the only instrument for finding it is a filter the
 * operator has to think to click.
 */
const HEALTH_RANK: Record<EntraClientHealth, number> = {
  failed: 0,
  partial: 1,
  never: 2,
  running: 3,
  synced: 4,
};

export function sortEntraClientsWorstFirst(
  mappings: EntraConfirmedMapping[]
): EntraConfirmedMapping[] {
  return [...mappings].sort((left, right) => {
    const byHealth = HEALTH_RANK[entraClientHealth(left)] - HEALTH_RANK[entraClientHealth(right)];
    if (byHealth !== 0) return byHealth;

    // Within a bucket, stalest first: the oldest sync is the next thing to look at.
    const leftAt = left.lastSyncedAt ? Date.parse(left.lastSyncedAt) : 0;
    const rightAt = right.lastSyncedAt ? Date.parse(right.lastSyncedAt) : 0;
    if (leftAt !== rightAt) return leftAt - rightAt;

    return (left.clientName || '').localeCompare(right.clientName || '');
  });
}

/** How many clients sit behind each filter, so a filter says whether it is worth clicking. */
export function countEntraClientsByFilter(
  mappings: EntraConfirmedMapping[]
): Record<EntraClientFilter, number> {
  return ENTRA_CLIENT_FILTERS.reduce(
    (counts, filter) => ({
      ...counts,
      [filter]: mappings.filter((mapping) => matchesEntraClientFilter(mapping, filter)).length,
    }),
    {} as Record<EntraClientFilter, number>
  );
}
