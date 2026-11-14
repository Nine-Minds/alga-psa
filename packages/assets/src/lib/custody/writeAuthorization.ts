import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  createAssetReadContext,
  isAssetActionAllowed,
  type AssetAuthUser,
  type AssetAuthorizationAction,
  type AssetReadAuthorizationContext,
} from '../assetReadAuthorization';
import type { CustodyEventInput } from '../schemas/assetCustody.schema';
import { CustodyError } from './errors';
import { closeCustodyEpisode, type ClosableCustodyReason } from './closeCustodyEpisode';
import { recordCustodyEvent } from './recordCustodyEvent';
import { loadCustody } from './shared';

/** Record-level asset action check shared by the transport services and transaction-taking custody cores. */
export async function assertAssetAuthorized(
  knex: Knex | Knex.Transaction,
  tenant: string,
  ctx: AssetReadAuthorizationContext,
  assetId: string,
  action: AssetAuthorizationAction = 'read'
): Promise<{ asset_id: string; client_id: string }> {
  const asset = await tenantDb(knex, tenant)
    .table('assets')
    .where({ asset_id: assetId })
    .select('asset_id', 'client_id')
    .first();
  if (!asset || !(await isAssetActionAllowed(knex, tenant, ctx, asset, action))) {
    throw new CustodyError('not_found', 'Asset not found.');
  }
  return asset;
}

/** Resolve an episode's asset and preserve the indistinguishable not_found refusal for either miss. */
export async function authorizeCustodyEpisode(
  knex: Knex | Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  custodyId: string,
  action: AssetAuthorizationAction = 'read'
) {
  const ctx = await createAssetReadContext(knex, tenant, user);
  let custody;
  try {
    custody = await loadCustody(knex, tenant, custodyId);
  } catch {
    throw new CustodyError('not_found', 'Custody record not found.');
  }
  await assertAssetAuthorized(knex, tenant, ctx, custody.asset_id, action).catch(() => {
    throw new CustodyError('not_found', 'Custody record not found.');
  });
  return custody;
}

/** RMA callers use this transport-neutral write boundary inside their existing transaction. */
export async function recordCustodyEventWithAuthorization(
  trx: Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  custodyId: string,
  input: CustodyEventInput
) {
  await authorizeCustodyEpisode(trx, tenant, user, custodyId, 'update');
  return recordCustodyEvent(trx, tenant, user.user_id, custodyId, input);
}

/** RMA callers use this transport-neutral close boundary inside their existing transaction. */
export async function closeCustodyEpisodeWithAuthorization(
  trx: Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  custodyId: string,
  reason: ClosableCustodyReason,
  options: { note?: string | null; rmaId?: string | null; rmaNumber?: string | null } = {}
) {
  await authorizeCustodyEpisode(trx, tenant, user, custodyId, 'update');
  return closeCustodyEpisode(trx, tenant, user.user_id, custodyId, reason, options);
}
