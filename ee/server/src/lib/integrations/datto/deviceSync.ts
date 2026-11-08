/**
 * Datto RMM bulk device sync, as a callable engine.
 *
 * Like Tactical's engine this lives outside the actions module on purpose:
 * every export from a server-actions file is a callable RPC endpoint, so an
 * unauthenticated sync cannot be exported from there. The action keeps the
 * permission check and delegates here; the scheduled job calls this directly
 * with no acting user (the event payload models that as actorType 'SYSTEM').
 *
 * Unlike Tactical's engine this one does not own the asset writes. Each device
 * is normalized to a snapshot and handed to the shared
 * ingestNormalizedRmmDeviceSnapshot, the same path Level.io uses.
 */
import { createHash } from 'node:crypto';

import axios from 'axios';
import type { Knex } from 'knex';

import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@alga-psa/db';
import { ingestNormalizedRmmDeviceSnapshot } from '@alga-psa/shared/rmm/sharedAssetIngestionService';
import type { NormalizedRmmExternalDeviceSnapshot } from '@alga-psa/shared/rmm/contracts';

import { tenantScopedTable } from './db';
import { publishRmmSyncEvent as publishCommonRmmSyncEvent } from './events';
import { axiosErrorToMessage as commonAxiosErrorToMessage } from './errors';
import { buildDattoClientForTenant, getDattoIntegrationRow } from './buildClient';
import { touchDattoDeviceLiveness, type DattoDeviceLivenessTouch } from './deviceLiveness';
import {
  DATTO_PAGE_SIZE,
  DattoRmmAuthError,
  DattoRmmReconnectRequiredError,
  DattoRmmPermissionError,
  type DattoRmmClient,
} from './dattoApiClient';
import {
  dattoAgentStatusFor,
  dattoTimestampToIso,
  dattoTimestampToMs,
  mapDattoAuditToHardware,
  mapDattoDeviceToSnapshot,
  mapDattoEsxiAuditToHardware,
  mapDattoPrinterAuditToHardware,
  type DattoHardware,
} from './mappers';
import { DATTO_RMM_PROVIDER } from './shared';
import type { DattoDevice } from './types';

const PROVIDER = DATTO_RMM_PROVIDER;

/** Upper bound on recorded error strings per run; the failure counts stay exact. */
const MAX_RECORDED_ERRORS = 100;

/** Upper bound on simultaneous audit calls, to stay inside Datto's account rate limit. */
export const DATTO_AUDIT_CONCURRENCY = 4;

/** Result shape shared by site sync, device sync, alert backfill and software ingest. */
export interface DattoSyncResult {
  success: boolean;
  items_processed: number;
  items_created: number;
  items_updated: number;
  items_failed: number;
  errors?: string[];
  error?: string;
}

export interface DattoDeviceSyncOptions {
  syncType?: 'full' | 'incremental';
  /** Only devices seen or audited at or after this instant are ingested. */
  since?: Date;
  /**
   * Restrict the run to these site uids. When given, a site is synced even if
   * its auto-sync flag is off (the caller asked for it by name); it still needs
   * a mapped client.
   */
  siteUids?: string[];
  /**
   * Re-ingest every device even when its snapshot hash is unchanged. Defaults
   * to true for a full sync, so the manual full run stays the way to rewrite
   * every asset from Datto; incremental runs skip unchanged devices.
   */
  force?: boolean;
}

export async function publishRmmSyncEvent(args: Omit<Parameters<typeof publishCommonRmmSyncEvent>[0], 'provider'>) {
  return publishCommonRmmSyncEvent({ ...args, provider: PROVIDER });
}

/** A failure whose message was written for the UI and is safe to show as-is. */
export class DattoSyncConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DattoSyncConfigError';
  }
}

/**
 * User-facing message for a failed Datto call. The client's own auth and
 * permission errors are already written to be shown; anything else goes
 * through the shared mapper so no URL, header or body can leak.
 */
export function dattoErrorMessage(err: unknown): string {
  if (
    err instanceof DattoSyncConfigError
    || err instanceof DattoRmmAuthError
    || err instanceof DattoRmmPermissionError
    || err instanceof DattoRmmReconnectRequiredError
  ) {
    return err.message;
  }
  return commonAxiosErrorToMessage(err, 'Datto RMM');
}

function httpStatus(err: unknown): number | undefined {
  if (err instanceof DattoRmmPermissionError) return err.status;
  if (axios.isAxiosError(err)) return err.response?.status;
  return undefined;
}

function parseSettings(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function parseMetadata(value: unknown): Record<string, unknown> {
  return parseSettings(value);
}

/**
 * Whether a device falls inside an incremental window.
 *
 * Datto has no server-side delta, so "incremental" is the same page walk with
 * the result filtered on lastSeen / lastAuditDate. Inclusive at the boundary,
 * and a device with neither timestamp (missing or unparseable) is always
 * considered, so absent data cannot exclude it from every run forever.
 */
export function dattoDeviceChangedSince(device: DattoDevice, since?: Date): boolean {
  if (!since) return true;
  const seen = dattoTimestampToMs(device?.lastSeen);
  const audited = dattoTimestampToMs(device?.lastAuditDate);
  if (seen === null && audited === null) return true;
  const cutoff = since.getTime();
  return (seen !== null && seen >= cutoff) || (audited !== null && audited >= cutoff);
}

/**
 * Whether an incremental run should ingest this device: it changed inside the
 * window, or the asset is out of step with Datto. lastSeen stops moving once a
 * device goes offline, so the time filter alone would leave it 'online' forever;
 * comparing the stored agent status catches that. A device with no asset yet
 * (newly visible on an auto-sync site) is always picked up, except a deleted
 * one, which ingestion has nothing to mark.
 */
export function dattoDeviceNeedsSync(
  device: DattoDevice,
  existing: ExistingDeviceState | undefined,
  since?: Date
): boolean {
  if (dattoDeviceChangedSince(device, since)) return true;
  if (!existing?.assetId) return device.deleted !== true;
  return existing.agentStatus !== dattoAgentStatusFor(device);
}

/** Which audit endpoint a device class has, if any. */
function auditKindFor(device: DattoDevice): 'device' | 'printer' | 'esxihost' | null {
  const deviceClass = String(device.deviceClass ?? 'device').trim().toLowerCase();
  if (deviceClass === 'device' || deviceClass === '') return 'device';
  if (deviceClass === 'printer') return 'printer';
  if (deviceClass === 'esxihost') return 'esxihost';
  return null;
}

/**
 * Fetches and maps the audit for one device. Returns null when the device has
 * no audit endpoint, or Datto reports none (404). A 403 is thrown through so
 * the caller can stop requesting audits for the rest of the run.
 */
export async function fetchDattoHardware(
  client: Pick<DattoRmmClient, 'getDeviceAudit' | 'getPrinterAudit' | 'getEsxiHostAudit'>,
  device: DattoDevice
): Promise<DattoHardware | null> {
  const kind = auditKindFor(device);
  if (!kind) return null;
  try {
    if (kind === 'printer') return mapDattoPrinterAuditToHardware(await client.getPrinterAudit(device.uid));
    if (kind === 'esxihost') return mapDattoEsxiAuditToHardware(await client.getEsxiHostAudit(device.uid));
    return mapDattoAuditToHardware(await client.getDeviceAudit(device.uid));
  } catch (err) {
    if (httpStatus(err) === 404) return null;
    throw err;
  }
}

/** Runs `worker` over `items` with at most `limit` in flight, preserving result order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  });
  await Promise.all(lanes);
  return results;
}

export interface ExistingDeviceState {
  assetId: string | null;
  /** The asset's type, so a skipped device's liveness lands in the right extension table. */
  assetType: string | null;
  storedLastAuditDate: string | null;
  serialNumber: string | null;
  /** The asset's current agent_status, to catch a device that silently went offline. */
  agentStatus: string | null;
  /** dattoSnapshotSyncHash of the snapshot the last ingest wrote. */
  syncHash: string | null;
  /** Mapping metadata keys written by other Datto modules (see carryOverDattoMappingMetadata). */
  carriedMetadata: Record<string, unknown>;
}

/**
 * Mapping metadata keys owned by something other than the device snapshot.
 * Ingestion replaces the mapping's metadata wholesale with the snapshot's, so
 * these have to be copied back in or they are wiped on every device sync.
 */
const CARRIED_METADATA_KEYS = ['softwareIngestedAuditDate'] as const;

/**
 * Copies the carried keys from the existing mapping onto the snapshot's
 * metadata. Without this, software ingest (which compares
 * softwareIngestedAuditDate to lastAuditDate) would re-pull every device's
 * software after every device sync.
 */
export function carryOverDattoMappingMetadata(
  snapshot: { metadata?: Record<string, unknown> | null },
  prior: Pick<ExistingDeviceState, 'carriedMetadata'> | undefined
): void {
  if (!prior || !snapshot.metadata) return;
  for (const [key, value] of Object.entries(prior.carriedMetadata)) {
    if (!(key in snapshot.metadata)) snapshot.metadata[key] = value;
  }
}

/**
 * What the last sync left behind for these devices: whether an asset exists,
 * the lastAuditDate recorded on its external mapping, its current serial and
 * agent status, and the mapping keys other modules own. The serial matters because ingestion rewrites serial_number on every update;
 * when the audit is skipped we hand it the existing value back instead of
 * letting an audit-less snapshot blank it.
 */
export async function loadExistingDeviceState(
  knex: Knex,
  tenant: string,
  deviceUids: string[]
): Promise<Map<string, ExistingDeviceState>> {
  const state = new Map<string, ExistingDeviceState>();
  if (!deviceUids.length) return state;

  const mappings: any[] = await tenantScopedTable(knex, 'tenant_external_entity_mappings', tenant)
    .where({ integration_type: PROVIDER, alga_entity_type: 'asset' })
    .whereIn('external_entity_id', deviceUids)
    .select(['external_entity_id', 'alga_entity_id', 'metadata']);

  const assetIds = mappings.map((row) => String(row.alga_entity_id)).filter(Boolean);
  const assets: any[] = assetIds.length
    ? await tenantScopedTable(knex, 'assets', tenant)
        .whereIn('asset_id', assetIds)
        .select(['asset_id', 'asset_type', 'serial_number', 'agent_status'])
    : [];
  const assetById = new Map<string, any>(assets.map((row) => [String(row.asset_id), row]));

  for (const row of mappings) {
    const asset = assetById.get(String(row.alga_entity_id));
    const metadata = parseMetadata(row.metadata);
    state.set(String(row.external_entity_id), {
      assetId: asset ? String(asset.asset_id) : null,
      assetType: asset?.asset_type ? String(asset.asset_type) : null,
      storedLastAuditDate: dattoTimestampToIso(metadata.lastAuditDate as any),
      serialNumber: asset?.serial_number ? String(asset.serial_number) : null,
      agentStatus: asset?.agent_status ? String(asset.agent_status) : null,
      syncHash: typeof metadata.syncHash === 'string' ? metadata.syncHash : null,
      carriedMetadata: Object.fromEntries(
        CARRIED_METADATA_KEYS.filter((key) => metadata[key] !== undefined).map((key) => [key, metadata[key]])
      ),
    });
  }
  return state;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => typeof v !== 'undefined')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** Extension keys left out of the sync hash; see dattoSnapshotSyncHash. */
const VOLATILE_OR_AUDIT_EXTENSION_KEYS: readonly string[] = [
  'uptimeSeconds',
  'manufacturer',
  'model',
  'cpuModel',
  'cpuCores',
  'ramGb',
  'diskUsage',
];

/** Top-level snapshot keys left out of the sync hash; audit-derived or volatile. */
const VOLATILE_OR_AUDIT_SNAPSHOT_KEYS: readonly string[] = [
  'lastSeenAt',
  'serialNumber',
  'extension',
  'metadata',
];

/**
 * Fingerprint of everything an ingest would write for this device from the
 * listing, minus the readings that move on every poll (lastSeen, uptime):
 * those are refreshed in bulk by touchDattoDeviceLiveness instead. Audit-derived
 * fields (hardware, serial) are left out because they are only present on runs
 * that audited, and a device audited this run is always ingested; a re-audit
 * also moves lastAuditDate, which is hashed. The mapping's client and people
 * mode are folded in so re-pointing a site or changing its mode re-ingests.
 */
export function dattoSnapshotSyncHash(
  snapshot: NormalizedRmmExternalDeviceSnapshot,
  context: { clientId: string | null; assignmentMode: string | null }
): string {
  const omit = (value: object | null | undefined, keys: readonly string[]) =>
    Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !keys.includes(key)));
  const rest = omit(snapshot, VOLATILE_OR_AUDIT_SNAPSHOT_KEYS);
  const stableExtension = omit(snapshot.extension, VOLATILE_OR_AUDIT_EXTENSION_KEYS);
  const stableMetadata = omit(snapshot.metadata, ['syncHash']);
  return createHash('sha256')
    .update(stableStringify({ ...rest, extension: stableExtension, metadata: stableMetadata, context }))
    .digest('hex')
    .slice(0, 32);
}

/**
 * Per-site paging costs at least one call per site; the account listing costs
 * ceil(account devices / page). Pick the account walk only when the device
 * counts site sync recorded say it is cheaper. Unknown counts keep the per-site
 * walk, which never reads devices from sites that are not synced.
 */
export function chooseDattoDeviceListing(
  synced: Array<{ deviceCount: number | null }>,
  all: Array<{ deviceCount: number | null }>
): 'account' | 'site' {
  if (synced.length < 2) return 'site';
  if (all.some((row) => row.deviceCount === null)) return 'site';
  const pages = (count: number) => Math.max(1, Math.ceil(count / DATTO_PAGE_SIZE));
  const siteCost = synced.reduce((sum, row) => sum + pages(row.deviceCount ?? 0), 0);
  const accountCost = pages(all.reduce((sum, row) => sum + (row.deviceCount ?? 0), 0));
  return accountCost < siteCost ? 'account' : 'site';
}

function deviceCountOf(metadata: Record<string, unknown>): number | null {
  const value = metadata.device_count;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

interface SiteContext {
  siteUid: string;
  siteName: string | null;
  clientId: string;
  assignmentMode: string | null;
}

/**
 * The audit is worth a call only when there is no asset yet or Datto re-audited
 * since.
 */
function needsAudit(device: DattoDevice, existing: ExistingDeviceState | undefined): boolean {
  if (device.deleted === true) return false;
  if (!auditKindFor(device)) return false;
  if (!existing?.assetId) return true;
  return existing.storedLastAuditDate !== dattoTimestampToIso(device.lastAuditDate);
}

/**
 * Walks every auto-sync-enabled site mapping and upserts its devices as assets.
 * Never deletes: a device missing from the listing is left alone, which is what
 * makes the incremental filter safe.
 *
 * Devices come from one account-wide listing or a walk per site, whichever
 * chooseDattoDeviceListing says costs fewer calls. Unless forced (a full sync
 * is), a device whose snapshot hash matches the last ingest only has its
 * liveness refreshed, in bulk.
 */
export async function runDattoRmmDeviceSync(
  args: { tenant: string; actorUserId?: string },
  options: DattoDeviceSyncOptions = {}
): Promise<DattoSyncResult> {
  const { tenant, actorUserId } = args;
  const syncType = options.syncType ?? 'full';
  const since = options.since;
  const siteFilter = options.siteUids?.length ? new Set(options.siteUids.map(String)) : null;
  const force = options.force ?? syncType === 'full';
  const startedAt = Date.now();

  const errors: string[] = [];
  // Devices and sites that failed outright. Audit failures are warnings, not
  // failures: the device itself is still written.
  let failed = 0;
  // Used for emitting failure events in the catch block.
  let integrationId: string | undefined;
  let knex: Knex | undefined;

  try {
    ({ knex } = await createTenantKnex());
    const integration = await getDattoIntegrationRow(knex, tenant);

    if (!integration?.integration_id) {
      return emptyFailure('Datto RMM is not configured yet. Save settings first.');
    }

    const integrationIdForEvents = String(integration.integration_id);
    integrationId = integrationIdForEvents;

    await publishRmmSyncEvent({
      eventType: 'RMM_SYNC_STARTED',
      tenantId: tenant,
      actorUserId,
      integrationId: integrationIdForEvents,
      syncType: 'devices',
    });

    const client = await buildDattoClientForTenant(tenant, { allowInactive: true });
    if (!client) {
      throw new DattoSyncConfigError('Datto RMM credentials are not configured. Save and test the connection first.');
    }

    await tenantScopedTable(knex, 'rmm_integrations', tenant)
      .where({ provider: PROVIDER })
      .update({ sync_status: 'syncing', sync_error: null });

    const mappingRows: any[] = await tenantScopedTable(knex, 'rmm_organization_mappings', tenant)
      .where({ integration_id: integration.integration_id })
      .select([
        'external_organization_id',
        'external_organization_name',
        'client_id',
        'auto_sync_assets',
        'contact_assignment_mode',
        'metadata',
      ]);
    const knownSites = mappingRows
      .map((row) => ({ row, metadata: parseMetadata(row.metadata) }))
      // A site Datto no longer lists only answers 404; do not spend calls on it.
      .filter(({ metadata }) => metadata.missing_in_datto !== true);
    const syncedRows = knownSites.filter(({ row }) => {
      if (row.client_id == null) return false;
      return siteFilter ? siteFilter.has(String(row.external_organization_id)) : row.auto_sync_assets === true;
    });
    const sites: SiteContext[] = syncedRows.map(({ row }) => ({
      siteUid: String(row.external_organization_id),
      siteName: String(row.external_organization_name ?? '').trim() || null,
      clientId: String(row.client_id),
      assignmentMode: row.contact_assignment_mode ? String(row.contact_assignment_mode) : null,
    }));
    const listing = siteFilter
      ? 'site'
      : chooseDattoDeviceListing(
          syncedRows.map(({ metadata }) => ({ deviceCount: deviceCountOf(metadata) })),
          knownSites.map(({ metadata }) => ({ deviceCount: deviceCountOf(metadata) }))
        );

    let processed = 0;
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let pages = 0;
    let devicesSeen = 0;
    let auditCalls = 0;
    let failedSites = 0;
    let auditWarnings = 0;
    let firstSiteError: string | undefined;
    // A 403 on the audit endpoints is account-wide (security level), so one is
    // enough to stop asking for the rest of the run.
    let auditForbidden = false;
    const ingestedDeviceUids: string[] = [];
    const recordError = (message: string) => {
      if (errors.length < MAX_RECORDED_ERRORS) errors.push(message);
    };
    const tenantKnex = knex;

    // One listing page: decide what is due, audit what needs it, then ingest
    // what changed and refresh liveness for the rest in bulk.
    const processBatch = async (entries: Array<{ device: DattoDevice; site: SiteContext }>) => {
      if (!entries.length) return;
      const existing = await loadExistingDeviceState(tenantKnex, tenant, entries.map((entry) => entry.device.uid));
      const due = entries.filter(({ device }) => dattoDeviceNeedsSync(device, existing.get(device.uid), since));
      if (!due.length) return;

      const hardwareByUid = new Map<string, DattoHardware | null>();
      const auditFailures = new Map<string, string>();
      const toAudit = auditForbidden
        ? []
        : due.map((entry) => entry.device).filter((device) => needsAudit(device, existing.get(device.uid)));
      await mapWithConcurrency(toAudit, DATTO_AUDIT_CONCURRENCY, async (device) => {
        if (auditForbidden) return;
        auditCalls += 1;
        try {
          hardwareByUid.set(device.uid, await fetchDattoHardware(client, device));
        } catch (err) {
          if (httpStatus(err) === 403) {
            auditForbidden = true;
            return;
          }
          auditFailures.set(device.uid, dattoErrorMessage(err));
        }
      });

      const touches: DattoDeviceLivenessTouch[] = [];
      for (const { device, site } of due) {
        processed += 1;

        try {
          const prior = existing.get(device.uid);
          const audited = hardwareByUid.has(device.uid);
          const hardware = hardwareByUid.get(device.uid) ?? null;
          const snapshot = mapDattoDeviceToSnapshot(device, {
            integrationId: integrationIdForEvents,
            siteUid: site.siteUid,
            siteName: site.siteName,
            hardware,
          });
          // Ingestion rewrites serial_number on every update, so a snapshot
          // without one (audit skipped, unavailable, or serial-less) must
          // carry the value the asset already has.
          if (!snapshot.serialNumber && prior?.serialNumber) snapshot.serialNumber = prior.serialNumber;
          // Ingestion replaces the mapping's metadata wholesale.
          carryOverDattoMappingMetadata(snapshot, prior);
          // A forbidden or failed audit never produced hardware for this
          // device: keep the marker the mapping already had so the audit is
          // retried on a later run.
          const auditFailure = auditFailures.get(device.uid);
          if (!audited && (auditForbidden || auditFailure) && snapshot.metadata) {
            snapshot.metadata.lastAuditDate = prior?.storedLastAuditDate ?? null;
          }

          const syncHash = dattoSnapshotSyncHash(snapshot, {
            clientId: site.clientId,
            assignmentMode: site.assignmentMode,
          });
          if (!force && !audited && prior?.assetId && prior.syncHash === syncHash) {
            unchanged += 1;
            touches.push({
              assetId: prior.assetId,
              assetType: prior.assetType ?? snapshot.assetType,
              lastSeenAt: snapshot.lastSeenAt ?? null,
              uptimeSeconds: snapshot.extension?.uptimeSeconds ?? null,
            });
            continue;
          }
          if (snapshot.metadata) snapshot.metadata.syncHash = syncHash;

          const outcome = await ingestNormalizedRmmDeviceSnapshot({
            tenant,
            snapshot,
            resolvedClientId: site.clientId,
            knex: tenantKnex,
          });

          if (outcome.action === 'failed') {
            failed += 1;
            recordError(`${device.uid}: ${outcome.error ?? 'ingestion failed'}`);
            continue;
          }
          if (auditFailure) {
            auditWarnings += 1;
            recordError(`${device.uid}: audit failed, device synced without hardware details: ${auditFailure}`);
          }
          if (outcome.action === 'created') created += 1;
          if (outcome.action === 'updated' || outcome.action === 'marked_deleted') updated += 1;
          if (outcome.action === 'created' || outcome.action === 'updated') ingestedDeviceUids.push(device.uid);
        } catch (err) {
          failed += 1;
          recordError(`${device.uid}: ${dattoErrorMessage(err)}`);
        }
      }

      if (touches.length) {
        try {
          await touchDattoDeviceLiveness(tenantKnex, tenant, touches);
        } catch (err) {
          recordError(`Refreshing last-seen for ${touches.length} unchanged devices failed: ${dattoErrorMessage(err)}`);
        }
      }
    };

    // The account listing either completes or fails the run: a partial walk
    // cannot be told apart from a small estate. Only a failure before the first
    // page (an endpoint this API user cannot read) falls back to per-site.
    const walkAccount = async (): Promise<boolean> => {
      const siteByUid = new Map(sites.map((site) => [site.siteUid, site]));
      let pagesRead = 0;
      try {
        for await (const page of client.pageAccountDevices()) {
          pagesRead += 1;
          pages += 1;
          devicesSeen += page.length;
          const entries: Array<{ device: DattoDevice; site: SiteContext }> = [];
          for (const device of page) {
            if (!device?.uid) continue;
            const site = siteByUid.get(String(device.siteUid ?? ''));
            if (site) entries.push({ device, site });
          }
          await processBatch(entries);
        }
        return true;
      } catch (err) {
        if (err instanceof DattoRmmAuthError || pagesRead > 0) throw err;
        logger.warn('[DattoRmmDeviceSync] account device listing failed; falling back to per-site', {
          tenant,
          provider: PROVIDER,
          error: dattoErrorMessage(err),
        });
        return false;
      }
    };

    const walkSites = async () => {
      for (const site of sites) {
        // One site that Datto no longer serves (deleted, 403, 5xx) must not stop
        // the rest of the estate from syncing. Credential failures are the
        // exception: every other site would fail the same way.
        try {
          for await (const page of client.pageSiteDevices(site.siteUid)) {
            pages += 1;
            devicesSeen += page.length;
            await processBatch(page.filter((device) => device?.uid).map((device) => ({ device, site })));
          }
        } catch (err) {
          if (err instanceof DattoRmmAuthError) throw err;
          const message = dattoErrorMessage(err);
          failedSites += 1;
          failed += 1;
          firstSiteError ??= message;
          recordError(`Site ${site.siteName ?? site.siteUid} (${site.siteUid}): ${message}`);
        }
      }

      // Nothing could be reached at all: report it as a failed run rather than a
      // green one, so the scheduler retries and the UI shows the cause.
      if (sites.length > 0 && failedSites === sites.length) {
        throw new DattoSyncConfigError(
          `Every Datto RMM site failed to sync (${failedSites}). First error: ${firstSiteError}`
        );
      }
    };

    let listingUsed: 'account' | 'site' = listing;
    if (sites.length && !(listing === 'account' && (await walkAccount()))) {
      listingUsed = 'site';
      await walkSites();
    }

    const fullSweep = syncType === 'full' && !siteFilter;
    await tenantScopedTable(knex, 'rmm_integrations', tenant)
      .where({ provider: PROVIDER })
      .update({
        sync_status: 'completed',
        last_sync_at: knex.fn.now(),
        ...(fullSweep ? { last_full_sync_at: knex.fn.now() } : {}),
        sync_error: errors.length ? errors.slice(0, 5).join('; ') : null,
      });

    await publishRmmSyncEvent({
      eventType: 'RMM_SYNC_COMPLETED',
      tenantId: tenant,
      actorUserId,
      integrationId: integrationIdForEvents,
      syncType: 'devices',
      itemsProcessed: processed,
      itemsCreated: created,
      itemsUpdated: updated,
      itemsFailed: failed,
    });

    logger.info('[DattoRmmDeviceSync] run complete', {
      tenant,
      provider: PROVIDER,
      syncType,
      sites: sites.length,
      listing: listingUsed,
      pages,
      devices: devicesSeen,
      processed,
      unchanged,
      auditCalls,
      requestCount: client.requestCount,
      failed,
      failedSites,
      auditWarnings,
      durationMs: Date.now() - startedAt,
    });

    await ingestSoftwareAfterSync({
      tenant,
      settings: parseSettings(integration.settings),
      deviceUids: ingestedDeviceUids,
    });

    return {
      success: true,
      items_processed: processed,
      items_created: created,
      items_updated: updated,
      items_failed: failed,
      errors: errors.length ? errors : undefined,
    };
  } catch (err) {
    const message = dattoErrorMessage(err);
    if (knex && integrationId) {
      await tenantScopedTable(knex, 'rmm_integrations', tenant)
        .where({ provider: PROVIDER })
        .update({ sync_status: 'error', sync_error: message })
        .catch(() => undefined);
    }
    if (integrationId) {
      await publishRmmSyncEvent({
        eventType: 'RMM_SYNC_FAILED',
        tenantId: tenant,
        actorUserId,
        integrationId,
        syncType: 'devices',
        errorMessage: message,
      });
    }
    logger.warn('[DattoRmmDeviceSync] run failed', {
      tenant,
      provider: PROVIDER,
      syncType,
      durationMs: Date.now() - startedAt,
      error: message,
    });
    return {
      success: false,
      error: message,
      items_processed: 0,
      items_created: 0,
      items_updated: 0,
      items_failed: failed,
      errors: errors.length ? errors : undefined,
    };
  }
}

function emptyFailure(error: string): DattoSyncResult {
  return {
    success: false,
    error,
    items_processed: 0,
    items_created: 0,
    items_updated: 0,
    items_failed: 0,
  };
}

/**
 * Opt-in follow-up: when the tenant enabled software ingest on sync, pull the
 * software lists for the devices this run just wrote. Loaded dynamically and
 * never allowed to fail the device sync — the assets are already written.
 */
async function ingestSoftwareAfterSync(args: {
  tenant: string;
  settings: Record<string, unknown>;
  deviceUids: string[];
}): Promise<void> {
  if (args.settings.softwareIngestOnSync !== true || !args.deviceUids.length) return;
  try {
    const { runDattoRmmSoftwareIngest } = await import('./softwareIngest');
    const result = await runDattoRmmSoftwareIngest({ tenant: args.tenant, deviceUids: args.deviceUids });
    if (!result.success) {
      logger.warn('[DattoRmmDeviceSync] software ingest after sync reported failure', {
        tenant: args.tenant,
        provider: PROVIDER,
        error: result.error,
      });
    }
  } catch (err) {
    logger.warn('[DattoRmmDeviceSync] software ingest after sync failed', {
      tenant: args.tenant,
      provider: PROVIDER,
      error: dattoErrorMessage(err),
    });
  }
}
