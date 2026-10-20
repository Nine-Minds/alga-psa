import type { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationRecord,
  type AuthorizationSubject,
} from '@alga-psa/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';
import {
  recordUrl,
  type IUserWithRoles,
  type LabelRequestContext,
  type LabelViewModel,
  type LabelViewModelProvider,
} from '@alga-psa/types';

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

// LEVERAGE: pattern asset-read-authorization — the subject/record resolution below repeats
// assetActions.ts (resolveAuthorizationSubjectForUser / resolveAssetAuthorizationRecords), which sits
// in a 'use server' file and cannot export helpers. A non-action assets/lib module would let both share it.
async function resolveSubject(trx: Knex, tenant: string, user: IUserWithRoles): Promise<AuthorizationSubject> {
  const db = tenantDb(trx, tenant);
  const roleRows = await db.table('user_roles').where({ user_id: user.user_id }).select<{ role_id: string }[]>('role_id');
  const teamRows = await db.table('team_members').where({ user_id: user.user_id }).select<{ team_id: string }[]>('team_id');
  const managedRows = await db.table('users').where({ reports_to: user.user_id }).select<{ user_id: string }[]>('user_id');
  return {
    tenant,
    userId: user.user_id,
    userType: user.user_type,
    roleIds: roleRows.map((row) => row.role_id),
    teamIds: teamRows.map((row) => row.team_id),
    managedUserIds: managedRows.map((row) => row.user_id),
    clientId: user.clientId ?? null,
    portfolioClientIds: user.clientId ? [user.clientId] : [],
  };
}

async function resolveRecord(
  trx: Knex,
  tenant: string,
  asset: { asset_id: string; client_id: string | null }
): Promise<AuthorizationRecord> {
  const associations = await tenantDb(trx, tenant)
    .table('asset_associations')
    .where({ asset_id: asset.asset_id })
    .select<Array<{ entity_type: string; entity_id: string }>>('entity_type', 'entity_id');
  const assignedUserIds = associations.filter((a) => a.entity_type === 'user').map((a) => a.entity_id);
  const teamIds = associations.filter((a) => a.entity_type === 'team').map((a) => a.entity_id);
  return {
    id: asset.asset_id,
    ownerUserId: assignedUserIds[0] ?? null,
    assignedUserIds,
    clientId: asset.client_id ?? null,
    teamIds,
  };
}

export const assetLabelViewModelProvider: LabelViewModelProvider = {
  entityType: 'asset',
  labelClass: 'asset-identity',

  async getLabelViewModels(context: LabelRequestContext, ids: readonly string[]) {
    if (!(await hasPermission(context.user, 'asset', 'read'))) {
      return ids.map(() => null);
    }
    const { knex } = await createTenantKnex(context.tenant);
    const subject = await resolveSubject(knex, context.tenant, context.user);
    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      bundleProvider: new BundleAuthorizationKernelProvider({
        resolveRules: async (input) => {
          try {
            return await resolveBundleNarrowingRulesForEvaluation(knex as Knex.Transaction, input);
          } catch {
            return [];
          }
        },
      }),
      rbacEvaluator: async () => true,
    });
    const requestCache = new RequestLocalAuthorizationCache();

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

        const decision = await kernel.authorizeResource({
          subject,
          resource: { type: 'asset', action: 'read', id: row.asset_id },
          record: await resolveRecord(knex, context.tenant, row),
          requestCache,
          knex,
        });
        if (!decision.allowed) {
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
