import type { Knex } from 'knex';
import type { IAssetCustody, IAssetCustodyEvent, IProjectStagingLine } from '@alga-psa/types';
import { openCustody } from '@alga-psa/assets/lib/custody/openCustody';
import { recordCustodyEvent } from '@alga-psa/assets/lib/custody/recordCustodyEvent';
import { CustodyError } from '@alga-psa/assets/lib/custody/errors';
import {
  publishEquipmentReceived,
  publishRecordedCustodyEvent,
} from '@alga-psa/assets/lib/custody/service';
import { createAssetReadContext, type AssetAuthUser } from '@alga-psa/assets/lib/assetReadAuthorization';
import { assertAssetAuthorized } from '@alga-psa/assets/lib/custody/writeAuthorization';
import { StagingError } from './staging';
import { stagingContainerIdentifier } from './stagingContainers';

/**
 * Client-owned staging through equipment custody (alga-2026-0002683, C6 follow-up). Design of record:
 * docs/plans/2026-11-23-client-owned-staging-custody.md (D1-D9).
 *
 * This is the ONLY staging code that calls the C4 custody cores (`openCustody`, `recordCustodyEvent`). It
 * never touches stock_units / stock_movements / stock_levels / project_materials: custody is a property
 * of the asset, and a client asset has no stock identity.
 *
 * - The link between a line and its episode is `asset_id` (D2): the open `asset_custody` row of the asset.
 * - A box is a custody *bin* (D3): its identifier (`PRJ-0042-B03`) is the `bin`.
 * - Cores run inside the caller's transaction. Results are queued on `ctx.publications` and published
 *   after commit by `publishStagingCustody` (D8). Callers that pass no context (task/project delete
 *   cascades) still write the custody rows; they just have no one to publish for.
 * - Authorization (D7): `ctx.authorizeAsset` resolves `asset:update` for one asset and throws a
 *   `StagingError('custody_forbidden')` when refused. It is supplied by the projects action wrappers; this
 *   lib owns semantics, not permissions.
 * - Release, task delete and project delete NEVER close custody: they only take the item out of its box.
 *   Only install closes an episode (`installed_at_client`).
 */

export type StagingCustodyPublication =
  | { kind: 'opened'; asset: { asset_id: string; asset_tag: string; name: string; client_id: string; asset_type: string }; custody: IAssetCustody; event: IAssetCustodyEvent; assetStatusChange: { assetId: string; before: string; after: string } | null }
  | { kind: 'recorded'; custody: IAssetCustody; event: IAssetCustodyEvent; assetStatusChange: { assetId: string; before: string; after: string } | null };

export interface StagingCustodyContext {
  /** Resolve `asset:update` for one client asset in this transaction; throws when refused. */
  authorizeAsset?: (trx: Knex.Transaction, assetId: string) => Promise<void>;
  /** Collects results so the caller can publish after commit. */
  publications?: StagingCustodyPublication[];
}

/**
 * D7: the context a projects action hands the staging lib. `canUpdateAssets` is the caller's RBAC
 * `asset:update` result; the record-level decision is the C4 helper (`assertAssetAuthorized(..., 'update')`).
 * Either refusal is the same typed `custody_forbidden`, scoped to the asset it concerns, and says nothing
 * about whether the asset exists.
 */
export function createStagingCustodyContext(input: {
  tenant: string;
  user: AssetAuthUser;
  canUpdateAssets: boolean;
}): StagingCustodyContext & { publications: StagingCustodyPublication[] } {
  const refusal = () =>
    new StagingError('Permission denied: asset update is required to move client equipment through custody', 'custody_forbidden');
  return {
    publications: [],
    authorizeAsset: async (trx, assetId) => {
      if (!input.canUpdateAssets) throw refusal();
      try {
        const ctx = await createAssetReadContext(trx, input.tenant, input.user);
        await assertAssetAuthorized(trx, input.tenant, ctx, assetId, 'update');
      } catch {
        throw refusal();
      }
    },
  };
}

type Trx = Knex.Transaction;
type Actor = string | null;

const isClientAssetLine = (line: Pick<IProjectStagingLine, 'kind' | 'asset_id'>): line is typeof line & { asset_id: string } =>
  line.kind === 'client_asset' && Boolean(line.asset_id);

/** Surface a custody refusal as a staging refusal the action layer already renders. */
async function custodyCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CustodyError) throw new StagingError(error.message, 'custody_refused');
    throw error;
  }
}

async function loadOpenEpisode(trx: Trx, tenant: string, assetId: string): Promise<IAssetCustody | null> {
  const row = await trx('asset_custody').where({ tenant, asset_id: assetId }).whereNull('closed_at').forUpdate().first();
  return (row as IAssetCustody | undefined) ?? null;
}

async function loadBox(trx: Trx, tenant: string, containerId: string) {
  const row = await trx('staging_containers as c')
    .join('projects as p', function () {
      this.on('p.project_id', '=', 'c.project_id').andOn('p.tenant', '=', 'c.tenant');
    })
    .where({ 'c.tenant': tenant, 'c.container_id': containerId })
    .first('c.container_id', 'c.sequence', 'c.stock_location_id', 'p.project_number', 'p.project_name');
  if (!row) throw new StagingError('Box not found', 'not_found');
  return {
    container_id: row.container_id as string,
    identifier: stagingContainerIdentifier(row.project_number, Number(row.sequence)),
    stock_location_id: (row.stock_location_id as string | null) ?? null,
    project_number: row.project_number as string,
    project_name: row.project_name as string,
  };
}

async function authorize(ctx: StagingCustodyContext | undefined, trx: Trx, assetId: string): Promise<void> {
  await ctx?.authorizeAsset?.(trx, assetId);
}

async function record(
  trx: Trx,
  tenant: string,
  performedBy: Actor,
  episode: IAssetCustody,
  input: Parameters<typeof recordCustodyEvent>[4],
  ctx: StagingCustodyContext | undefined,
): Promise<void> {
  const result = await custodyCall(() => recordCustodyEvent(trx, tenant, performedBy as string, episode.custody_id, input));
  ctx?.publications?.push({ kind: 'recorded', custody: result.custody, event: result.event, assetStatusChange: result.assetStatusChange });
}

/** Where a newly received client asset goes: the box's location, else the tenant default, else any active one. */
async function receivingLocation(trx: Trx, tenant: string, preferred: string | null): Promise<string> {
  if (preferred) return preferred;
  const row = await trx('stock_locations').where({ tenant, is_active: true }).orderBy('is_default', 'desc').orderBy('name', 'asc').first('location_id');
  if (!row) throw new StagingError('Create a stock location before staging client equipment: it needs somewhere to be held.', 'invalid_state');
  return row.location_id;
}

/**
 * D1: custody is a precondition. Link the asset's open episode (whatever its purpose: a repair stays a
 * repair), otherwise receive the asset with purpose `staging` in this transaction.
 */
export async function ensureCustodyForClientAsset(
  trx: Trx,
  tenant: string,
  assetId: string,
  performedBy: Actor,
  ctx: StagingCustodyContext | undefined,
  options: { projectNumber: string; locationId?: string | null },
): Promise<{ custody: IAssetCustody; opened: boolean }> {
  await authorize(ctx, trx, assetId);
  const existing = await loadOpenEpisode(trx, tenant, assetId);
  if (existing) return { custody: existing, opened: false };
  if (!performedBy) throw new StagingError('A user is required to receive client equipment into custody', 'invalid_input');

  const locationId = await receivingLocation(trx, tenant, options.locationId ?? null);
  const opened = await custodyCall(() =>
    openCustody(trx, tenant, performedBy, {
      asset_id: assetId,
      ticket_id: null,
      purpose: 'staging',
      location_id: locationId,
      bin: null,
      holder_user_id: undefined,
      next_action_party: 'msp',
      next_action_note: null,
      follow_up_on: null,
      condition_note: null,
      accessories: [],
      document_ids: [],
      note: `Staged for project ${options.projectNumber}`,
    }),
  );
  const asset = await trx('assets').where({ tenant, asset_id: assetId }).first('asset_id', 'asset_tag', 'name', 'client_id', 'asset_type');
  ctx?.publications?.push({ kind: 'opened', asset, custody: opened.custody, event: opened.event, assetStatusChange: opened.assetStatusChange });
  return { custody: opened.custody, opened: true };
}

/** D3: pack = `moved` to (box location, box identifier). A no-op when it is already in that bin. */
export async function custodyPackLine(
  trx: Trx,
  tenant: string,
  line: Pick<IProjectStagingLine, 'kind' | 'asset_id'>,
  containerId: string,
  performedBy: Actor,
  ctx: StagingCustodyContext | undefined,
): Promise<void> {
  if (!isClientAssetLine(line)) return;
  const box = await loadBox(trx, tenant, containerId);
  // A line that predates custody gets its episode here: staging a client asset requires one.
  const { custody } = await ensureCustodyForClientAsset(trx, tenant, line.asset_id, performedBy, ctx, {
    projectNumber: box.project_number,
    locationId: box.stock_location_id,
  });
  const episode = (await loadOpenEpisode(trx, tenant, line.asset_id)) ?? custody;
  if (episode.bin === box.identifier && (!box.stock_location_id || episode.location_id === box.stock_location_id)) return;
  await record(trx, tenant, performedBy, episode, {
    event_type: 'moved',
    ...(box.stock_location_id ? { location_id: box.stock_location_id } : {}),
    bin: box.identifier,
    note: `Packed into ${box.identifier}`,
    document_ids: [],
  }, ctx);
}

/** Unpack / release: `moved` out of the box (`from_bin = identifier`, `to_bin = null`). Never closes custody. */
export async function custodyUnpackLine(
  trx: Trx,
  tenant: string,
  line: Pick<IProjectStagingLine, 'kind' | 'asset_id'>,
  containerId: string,
  performedBy: Actor,
  ctx: StagingCustodyContext | undefined,
  reason: 'unpacked' | 'released' = 'unpacked',
): Promise<void> {
  if (!isClientAssetLine(line)) return;
  const box = await loadBox(trx, tenant, containerId);
  const episode = await loadOpenEpisode(trx, tenant, line.asset_id);
  // Nothing to move out of: the episode is gone, with a vendor, or someone already moved the device on.
  if (!episode || episode.state !== 'in_office' || episode.bin !== box.identifier) return;
  await authorize(ctx, trx, line.asset_id);
  await record(trx, tenant, performedBy, episode, {
    event_type: 'moved',
    bin: null,
    note: reason === 'released' ? `Released from ${box.identifier}` : `Removed from ${box.identifier}`,
    document_ids: [],
  }, ctx);
}

/** Every client-asset line of a box, for seal / reopen. */
async function boxClientAssets(trx: Trx, tenant: string, containerId: string): Promise<Array<{ staging_line_id: string; asset_id: string }>> {
  return trx('staging_container_members as m')
    .join('project_staging_lines as l', function () {
      this.on('l.staging_line_id', '=', 'm.staging_line_id').andOn('l.tenant', '=', 'm.tenant');
    })
    .where({ 'm.tenant': tenant, 'm.container_id': containerId, 'l.kind': 'client_asset' })
    .whereNotNull('l.asset_id')
    .orderBy('l.staging_line_id', 'asc')
    .select('l.staging_line_id', 'l.asset_id');
}

/** Seal / reopen: one `sealed` / `unsealed` event per client asset still in the box. */
export async function custodySealContainer(
  trx: Trx,
  tenant: string,
  containerId: string,
  eventType: 'sealed' | 'unsealed',
  performedBy: Actor,
  ctx: StagingCustodyContext | undefined,
): Promise<void> {
  const assets = await boxClientAssets(trx, tenant, containerId);
  if (assets.length === 0) return;
  const box = await loadBox(trx, tenant, containerId);
  for (const { asset_id } of assets) {
    await authorize(ctx, trx, asset_id);
    const episode = await loadOpenEpisode(trx, tenant, asset_id);
    if (!episode || episode.state !== 'in_office') continue;
    await record(trx, tenant, performedBy, episode, {
      event_type: eventType,
      note: eventType === 'sealed' ? `${box.identifier} sealed` : `${box.identifier} reopened`,
      document_ids: [],
    }, ctx);
  }
}

/**
 * A box being force-reopened by a release cascade: the same `unsealed` facts, for the client assets in the
 * given boxes, before their members go.
 */
export async function custodyUnsealContainers(
  trx: Trx,
  tenant: string,
  containerIds: readonly string[],
  performedBy: Actor,
  ctx: StagingCustodyContext | undefined,
): Promise<void> {
  for (const id of containerIds) await custodySealContainer(trx, tenant, id, 'unsealed', performedBy, ctx);
}

/**
 * Install closes custody (D4): a `returned` event with `close_reason = installed_at_client`, and the line
 * leaves its box. An asset with no open episode (closed meanwhile by another flow) has nothing to close.
 */
export async function custodyInstallLine(
  trx: Trx,
  tenant: string,
  line: Pick<IProjectStagingLine, 'staging_line_id' | 'kind' | 'asset_id' | 'project_id'>,
  performedBy: Actor,
  ctx: StagingCustodyContext | undefined,
): Promise<void> {
  if (!isClientAssetLine(line)) return;
  await authorize(ctx, trx, line.asset_id);
  const project = await trx('projects').where({ tenant, project_id: line.project_id }).first('project_number', 'project_name');
  const membership = await trx('staging_container_members').where({ tenant, staging_line_id: line.staging_line_id }).first('container_id');
  const box = membership ? await loadBox(trx, tenant, membership.container_id) : null;
  const episode = await loadOpenEpisode(trx, tenant, line.asset_id);
  if (episode) {
    await record(trx, tenant, performedBy, episode, {
      event_type: 'returned',
      counterparty: null,
      close_reason: 'installed_at_client',
      note: `Installed for project ${project?.project_number ?? ''}${project?.project_name ? ` (${project.project_name})` : ''}${box ? `, from ${box.identifier}` : ''}`.trim(),
      document_ids: [],
    }, ctx);
  }
  await trx('staging_container_members').where({ tenant, staging_line_id: line.staging_line_id }).delete();
}

/** Release path (user release, task delete, project delete): take the line out of its box; never close. */
export async function custodyReleaseLine(
  trx: Trx,
  tenant: string,
  line: Pick<IProjectStagingLine, 'staging_line_id' | 'kind' | 'asset_id'>,
  performedBy: Actor,
  ctx: StagingCustodyContext | undefined,
): Promise<void> {
  if (!isClientAssetLine(line)) return;
  const membership = await trx('staging_container_members').where({ tenant, staging_line_id: line.staging_line_id }).first('container_id');
  if (!membership) return;
  await custodyUnpackLine(trx, tenant, line, membership.container_id, performedBy, ctx, 'released');
}

/** D8: publish what the transaction queued, after it committed. Failures are logged by the publishers. */
export async function publishStagingCustody(
  tenant: string,
  user: AssetAuthUser,
  publications: readonly StagingCustodyPublication[],
): Promise<void> {
  for (const p of publications) {
    if (p.kind === 'opened') {
      await publishEquipmentReceived(tenant, user, {
        asset: p.asset,
        createdAsset: false,
        custody: p.custody,
        event: p.event,
        assetStatusChange: p.assetStatusChange,
      });
    } else {
      await publishRecordedCustodyEvent(tenant, user, { custody: p.custody, event: p.event, assetStatusChange: p.assetStatusChange });
    }
  }
}
