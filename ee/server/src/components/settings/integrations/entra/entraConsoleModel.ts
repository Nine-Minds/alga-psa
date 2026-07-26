import type {
  EntraConfirmedMapping,
  EntraStatusResponse,
  EntraSyncHistoryRun,
} from '@alga-psa/integrations/actions';

/**
 * What the console decides without the DOM: which tab a URL means, and what
 * deserves attention on the Overview. Kept pure so the attention rules — the
 * part an operator trusts to be complete — are testable directly.
 */

export const ENTRA_CONSOLE_TABS = [
  'overview',
  'schedule',
  'clients',
  'field-rules',
  'review-queue',
  'history',
  'connection',
] as const;

export type EntraConsoleTab = (typeof ENTRA_CONSOLE_TABS)[number];

export const DEFAULT_ENTRA_CONSOLE_TAB: EntraConsoleTab = 'overview';

export function parseEntraConsoleTab(value: string | null | undefined): EntraConsoleTab {
  const candidate = (value || '').trim().toLowerCase();
  return (ENTRA_CONSOLE_TABS as readonly string[]).includes(candidate)
    ? (candidate as EntraConsoleTab)
    : DEFAULT_ENTRA_CONSOLE_TAB;
}

export type EntraAttentionSeverity = 'blocking' | 'warning' | 'info';

export interface EntraAttentionItem {
  id: string;
  severity: EntraAttentionSeverity;
  titleKey: string;
  /**
   * The line under the title: what it means, or which clients it is about. An
   * attention list that only states counts makes the operator open every item
   * to find out whether it is one problem or five.
   */
  detailKey?: string;
  /** The button's own words — "Fix connection" beats a row of "Open"s. */
  actionKey: string;
  /** Interpolation values for the title and detail, already resolved to primitives. */
  values?: Record<string, string | number>;
  /** Tab to open when the operator acts on this. */
  tab: EntraConsoleTab;
}

/** At most three names, then a count — a list of 39 is not a summary. */
const NAMED_CLIENT_LIMIT = 3;

function namedClients(mappings: EntraConfirmedMapping[]): string {
  const names = mappings
    .map((mapping) => mapping.clientName || mapping.displayName || mapping.primaryDomain)
    .filter((name): name is string => Boolean(name));

  if (names.length <= NAMED_CLIENT_LIMIT) {
    return names.join(', ');
  }
  return `${names.slice(0, NAMED_CLIENT_LIMIT).join(', ')} +${names.length - NAMED_CLIENT_LIMIT}`;
}

export interface BuildEntraAttentionInput {
  status: EntraStatusResponse | null;
  mappings: EntraConfirmedMapping[];
  reviewQueueCount: number;
  scheduleEnabled: boolean;
  runs: EntraSyncHistoryRun[];
}

/**
 * The Overview's attention list, worst first.
 *
 * Failing clients are grouped into one item rather than one per client: a
 * broken connection produces N identical failures, and a list that repeats the
 * same root cause N times is a list nobody reads to the end.
 */
export function buildEntraAttentionItems(input: BuildEntraAttentionInput): EntraAttentionItem[] {
  const items: EntraAttentionItem[] = [];

  const connectionBroken = Boolean(input.status && input.status.status !== 'connected');
  if (connectionBroken) {
    items.push({
      id: 'connection',
      severity: 'blocking',
      titleKey: 'integrations.entra.console.attention.connection',
      detailKey: 'integrations.entra.console.attention.connectionDetail',
      actionKey: 'integrations.entra.console.attention.actions.fixConnection',
      tab: 'connection',
    });
  }

  // Client failures are only worth listing when the connection itself is fine;
  // otherwise they are all the same failure wearing different names.
  const failedClients = input.mappings.filter((mapping) => mapping.lastRunStatus === 'failed');
  if (!connectionBroken && failedClients.length > 0) {
    items.push({
      id: 'failed-clients',
      severity: 'blocking',
      titleKey: failedClients.length === 1
        ? 'integrations.entra.console.attention.failedClientsOne'
        : 'integrations.entra.console.attention.failedClients',
      detailKey: 'integrations.entra.console.attention.failedClientsDetail',
      actionKey: 'integrations.entra.console.attention.actions.viewClients',
      values: { count: failedClients.length, clients: namedClients(failedClients) },
      tab: 'clients',
    });
  }

  if (input.reviewQueueCount > 0) {
    items.push({
      id: 'review-queue',
      severity: 'warning',
      titleKey: input.reviewQueueCount === 1
        ? 'integrations.entra.console.attention.reviewQueueOne'
        : 'integrations.entra.console.attention.reviewQueue',
      detailKey: 'integrations.entra.console.attention.reviewQueueDetail',
      actionKey: 'integrations.entra.console.attention.actions.review',
      values: { count: input.reviewQueueCount },
      tab: 'review-queue',
    });
  }

  const neverSynced = input.mappings.filter((mapping) => !mapping.lastSyncedAt);
  if (neverSynced.length > 0) {
    items.push({
      id: 'never-synced',
      severity: 'warning',
      titleKey: neverSynced.length === 1
        ? 'integrations.entra.console.attention.neverSyncedOne'
        : 'integrations.entra.console.attention.neverSynced',
      detailKey: 'integrations.entra.console.attention.neverSyncedDetail',
      actionKey: 'integrations.entra.console.attention.actions.viewClients',
      values: { count: neverSynced.length, clients: namedClients(neverSynced) },
      tab: 'clients',
    });
  }

  if (!input.scheduleEnabled) {
    items.push({
      id: 'schedule-off',
      severity: 'info',
      titleKey: 'integrations.entra.console.attention.scheduleOff',
      detailKey: 'integrations.entra.console.attention.scheduleOffDetail',
      actionKey: 'integrations.entra.console.attention.actions.openSchedule',
      tab: 'schedule',
    });
  }

  return items;
}

export interface EntraRunTotals {
  linked: number;
  created: number;
  updated: number;
  inactivated: number;
  ambiguous: number;
  failed: number;
}

/**
 * The run, added up. The overview leads with what last night's sync did to the
 * contact list, which is a sum across clients, not a per-client table read.
 */
export function summarizeEntraRunResults(
  results: Array<{
    status?: string;
    created?: number;
    linked?: number;
    updated?: number;
    inactivated?: number;
    ambiguous?: number;
  }>
): EntraRunTotals {
  return results.reduce<EntraRunTotals>(
    (totals, result) => ({
      linked: totals.linked + (result.linked || 0),
      created: totals.created + (result.created || 0),
      updated: totals.updated + (result.updated || 0),
      inactivated: totals.inactivated + (result.inactivated || 0),
      ambiguous: totals.ambiguous + (result.ambiguous || 0),
      failed: totals.failed + (result.status === 'failed' ? 1 : 0),
    }),
    { linked: 0, created: 0, updated: 0, inactivated: 0, ambiguous: 0, failed: 0 }
  );
}

/** The last run that actually changed something — previews are not runs. */
export function findLastRealRun(runs: EntraSyncHistoryRun[]): EntraSyncHistoryRun | null {
  return runs.find((run) => !run.isDryRun) || null;
}

export interface EntraHistoryFilters {
  onlyFailures: boolean;
  trigger: 'all' | 'scheduled' | 'manual';
  includePreviews: boolean;
}

export const DEFAULT_ENTRA_HISTORY_FILTERS: EntraHistoryFilters = {
  onlyFailures: false,
  trigger: 'all',
  includePreviews: true,
};

const SCHEDULED_RUN_TYPES = new Set(['all-tenants']);

export function filterEntraRuns(
  runs: EntraSyncHistoryRun[],
  filters: EntraHistoryFilters
): EntraSyncHistoryRun[] {
  return runs.filter((run) => {
    if (!filters.includePreviews && run.isDryRun) {
      return false;
    }
    if (filters.onlyFailures && run.status !== 'failed' && run.status !== 'partial') {
      return false;
    }
    if (filters.trigger === 'scheduled' && !SCHEDULED_RUN_TYPES.has(run.runType)) {
      return false;
    }
    if (filters.trigger === 'manual' && SCHEDULED_RUN_TYPES.has(run.runType)) {
      return false;
    }
    return true;
  });
}

const CSV_COLUMNS = [
  'runId',
  'runType',
  'status',
  'isDryRun',
  'scope',
  'startedAt',
  'completedAt',
  'totalTenants',
  'succeededTenants',
  'failedTenants',
];

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * History as CSV, with the scope resolved to a client name — the whole point of
 * F12 is that a run report identifies clients the way the MSP does, not by
 * Microsoft tenant GUID.
 */
export function buildEntraRunHistoryCsv(
  runs: EntraSyncHistoryRun[],
  clientNamesByMappedTenant: Map<string, string>
): string {
  const lines = [CSV_COLUMNS.join(',')];

  for (const run of runs) {
    const scope = run.scopeManagedTenantId
      ? clientNamesByMappedTenant.get(run.scopeManagedTenantId) || run.scopeManagedTenantId
      : 'all clients';

    lines.push([
      run.runId,
      run.runType,
      run.status,
      run.isDryRun ? 'preview' : 'sync',
      scope,
      run.startedAt,
      run.completedAt || '',
      run.totalTenants,
      run.succeededTenants,
      run.failedTenants,
    ].map(csvCell).join(','));
  }

  return lines.join('\n');
}
