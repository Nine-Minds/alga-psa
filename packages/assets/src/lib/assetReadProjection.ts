import type { Knex } from 'knex';
import {
  authorizeReadableAssets,
  type AssetAuthorizationInput,
  type AssetReadAuthorizationContext,
} from '@alga-psa/authorization/assetReadAuthorization';
import {
  ASSET_RECORD_SOURCE,
  createRecordProjectionPolicy,
  type RecordProjectionPolicy,
  type RedactableRecordSource,
} from '@alga-psa/co-managed/recordProjection';

export interface AssetRecordProjection<T extends Record<string, any>> {
  record: Partial<T>;
  policy: RecordProjectionPolicy;
}

/** Authorize and project related asset records before callers filter, count, or serialize them. */
export async function projectReadableAssetRecords<T extends Record<string, any>>(
  trx: Knex | Knex.Transaction,
  tenant: string,
  context: AssetReadAuthorizationContext,
  records: readonly T[],
  assetForRecord: (record: T) => AssetAuthorizationInput,
  source: RedactableRecordSource = ASSET_RECORD_SOURCE,
): Promise<AssetRecordProjection<T>[]> {
  if (records.length === 0) return [];

  const assets = records.map(assetForRecord);
  const authorized = await authorizeReadableAssets(trx, tenant, context, assets);
  return authorized.flatMap(({ index, redactedFields }) => {
    const record = records[index];
    const policy = createRecordProjectionPolicy(redactedFields, ASSET_RECORD_SOURCE);
    const projection = policy.project(record, source);
    return projection === null ? [] : [{ record: projection, policy }];
  });
}
