import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  recordUrl,
  type LabelRequestContext,
  type LabelViewModel,
  type LabelViewModelProvider,
} from '@alga-psa/types';

import { createAssetReadContext, isAssetReadAllowed } from './assetReadAuthorization';

/**
 * Asset identity label data. Read-only; no side effects.
 *
 * Authorization happens BEFORE any asset field is read for output: coarse `asset:read` RBAC, then
 * the same per-record kernel decision the asset detail action makes. A missing asset and an asset
 * the caller may not read are both `null`, indistinguishable.
 *
 * The serial number is never included (identity labels carry tag, name and client only).
 */

const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

export const assetLabelViewModelProvider: LabelViewModelProvider = {
  entityType: 'asset',
  labelClass: 'asset-identity',

  async getLabelViewModels(context: LabelRequestContext, ids: readonly string[]) {
    if (!(await hasPermission(context.user, 'asset', 'read'))) {
      return ids.map(() => null);
    }
    const { knex } = await createTenantKnex(context.tenant);
    const authContext = await createAssetReadContext(knex, context.tenant, context.user);

    return Promise.all(
      ids.map(async (assetId): Promise<LabelViewModel | null> => {
        const facade = tenantDb(knex, context.tenant);
        const query = facade
          .table('assets as a')
          .where('a.asset_id', assetId)
          .select('a.asset_id', 'a.asset_tag', 'a.name', 'a.client_id', 'c.client_name');
        facade.tenantJoin(query, 'clients as c', 'a.client_id', 'c.client_id', { type: 'left' });
        const row = (await query.first()) as
          | {
              asset_id: string;
              asset_tag: string | null;
              name: string | null;
              client_id: string | null;
              client_name: string | null;
            }
          | undefined;
        if (!row) {
          return null;
        }

        if (!(await isAssetReadAllowed(knex, context.tenant, authContext, row))) {
          return null;
        }

        const tag = row.asset_tag ?? '';
        return {
          labelClass: 'asset-identity',
          entityType: 'asset',
          recordId: row.asset_id,
          url: recordUrl('asset', row.asset_id, context.baseUrl),
          identifier: tag || row.asset_id,
          // Code 128 here is a short tag lookup value, never the URL.
          code128Value: tag && PRINTABLE_ASCII.test(tag) ? tag : null,
          title: row.name ?? null,
          clientName: row.client_name ?? null,
          detail: null,
          secondaryIdentifier: null,
          serialSuffix: null,
        };
      })
    );
  },
};
