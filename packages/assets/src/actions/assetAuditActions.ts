'use server';

import { z } from 'zod';
import { hasPermission, withAuth } from '@alga-psa/auth';
import { createTenantKnex, type ServiceContext } from '@alga-psa/db';
import type {
  AssetAuditListPage,
  AssetAuditScopePreview,
  AssetAuditWithItems,
} from '@alga-psa/types';
import { permissionError, type ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  assetAuditListFiltersSchema,
  assetAuditScopeSchema,
  auditIdSchema,
  markAssetAuditItemSchema,
  startAssetAuditSchema,
} from '../lib/schemas/assetAudit.schema';
import type { AssetAuditService } from '../lib/audits/service';
import { toAuditResult, type AssetAuditActionResult } from '../lib/audits/actionResult';

/**
 * Site audit server actions — the web app's half of the lifecycle mobile drives
 * through /api/v1/asset-audits. Same service, same RBAC as the REST controller:
 * reads need `asset:read`, every write needs `asset:update` (completing an
 * audit writes asset history and the asset's last-audit columns).
 *
 * Refusals come back as values, not throws: Next masks thrown messages in
 * production, and the surfaces want the server's own wording.
 */

type Denied = ActionPermissionError;

async function denyUnless(
  user: Parameters<typeof hasPermission>[0],
  action: 'read' | 'update',
): Promise<Denied | null> {
  return (await hasPermission(user, 'asset', action))
    ? null
    : (permissionError(`Permission denied: Cannot ${action} asset audits`) as Denied);
}

/**
 * Loaded lazily so merely importing this module (every other action in the
 * barrel pulls it in) never evaluates `../lib/audits/service`: that module
 * declares `class AssetAuditService extends BaseService`, a module-scope
 * side effect that throws if a caller's '@alga-psa/db' mock doesn't happen to
 * export `BaseService` — a mock written long before this action, and for a
 * module it never otherwise touches.
 */
async function service(): Promise<AssetAuditService> {
  const { AssetAuditService: Service } = await import('../lib/audits/service');
  return new Service();
}

async function serviceContext(tenant: string, user: { user_id: string }): Promise<ServiceContext> {
  const { knex } = await createTenantKnex();
  return { tenant, userId: user.user_id, user, db: knex };
}

/** The audits list behind /msp/assets/audits and the client drawer's Audits tab. */
export const listAssetAudits = withAuth(
  async (
    user,
    { tenant },
    filters: z.input<typeof assetAuditListFiltersSchema> = {},
  ): Promise<AssetAuditActionResult<AssetAuditListPage> | Denied> => {
    const denied = await denyUnless(user, 'read');
    if (denied) return denied;
    return toAuditResult(async () => {
      const parsed = assetAuditListFiltersSchema.parse(filters);
      const page = await (await service()).list(parsed, await serviceContext(tenant, user as { user_id: string }));
      return { audits: page.data, total: page.total };
    });
  },
);

export const getAssetAudit = withAuth(
  async (
    user,
    { tenant },
    auditId: string,
  ): Promise<AssetAuditActionResult<AssetAuditWithItems> | Denied> => {
    const denied = await denyUnless(user, 'read');
    if (denied) return denied;
    return toAuditResult(async () =>
      (await service()).get(auditIdSchema.parse(auditId), await serviceContext(tenant, user as { user_id: string })),
    );
  },
);

/**
 * How many assets the audit would snapshot, for the start dialog's live count.
 *
 * Gated on asset:update rather than read on purpose: it is the probe the Start
 * audit affordances use, so a user who may not start one never sees the button
 * (the denied outcome folds into `canUpdate`, as custody's location list does).
 */
export const previewAssetAuditScope = withAuth(
  async (
    user,
    { tenant },
    scope: z.input<typeof assetAuditScopeSchema>,
  ): Promise<AssetAuditActionResult<AssetAuditScopePreview> | Denied> => {
    const denied = await denyUnless(user, 'update');
    if (denied) return denied;
    return toAuditResult(async () => {
      const parsed = assetAuditScopeSchema.parse(scope);
      if (!parsed.client_id) return { expected_count: 0 };
      const expected = await (await service()).previewScope(
        {
          client_id: parsed.client_id,
          location_id: parsed.location_id ?? null,
          statuses: parsed.statuses ?? null,
        },
        await serviceContext(tenant, user as { user_id: string }),
      );
      return { expected_count: expected };
    });
  },
);

export const startAssetAudit = withAuth(
  async (
    user,
    { tenant },
    input: z.input<typeof startAssetAuditSchema>,
  ): Promise<AssetAuditActionResult<AssetAuditWithItems> | Denied> => {
    const denied = await denyUnless(user, 'update');
    if (denied) return denied;
    return toAuditResult(async () =>
      (await service()).start(
        startAssetAuditSchema.parse(input),
        await serviceContext(tenant, user as { user_id: string }),
      ),
    );
  },
);

/**
 * Mark an asset present from a desktop. There is no camera on this surface, so
 * the method stored is always `manual` — the same value the API records for a
 * hand-typed mark.
 */
export const markAssetAuditItem = withAuth(
  async (
    user,
    { tenant },
    auditId: string,
    assetId: string,
  ): Promise<AssetAuditActionResult<AssetAuditWithItems> | Denied> => {
    const denied = await denyUnless(user, 'update');
    if (denied) return denied;
    return toAuditResult(async () => {
      const parsed = markAssetAuditItemSchema.parse({ asset_id: assetId, method: 'manual' });
      return (await service()).markItem(
        auditIdSchema.parse(auditId),
        parsed,
        await serviceContext(tenant, user as { user_id: string }),
      );
    });
  },
);

/**
 * Add an asset that was not in the snapshot. The service decides the result:
 * anything outside scope is stored `unexpected`, with method `manual`.
 */
export const addUnexpectedAuditAsset = withAuth(
  async (
    user,
    { tenant },
    auditId: string,
    assetId: string,
  ): Promise<AssetAuditActionResult<AssetAuditWithItems> | Denied> => {
    const denied = await denyUnless(user, 'update');
    if (denied) return denied;
    return toAuditResult(async () => {
      const parsed = markAssetAuditItemSchema.parse({ asset_id: assetId, method: 'manual' });
      return (await service()).markItem(
        auditIdSchema.parse(auditId),
        parsed,
        await serviceContext(tenant, user as { user_id: string }),
      );
    });
  },
);

export const unmarkAssetAuditItem = withAuth(
  async (
    user,
    { tenant },
    auditId: string,
    assetId: string,
  ): Promise<AssetAuditActionResult<AssetAuditWithItems> | Denied> => {
    const denied = await denyUnless(user, 'update');
    if (denied) return denied;
    return toAuditResult(async () =>
      (await service()).unmarkItem(
        auditIdSchema.parse(auditId),
        z.string().guid().parse(assetId),
        await serviceContext(tenant, user as { user_id: string }),
      ),
    );
  },
);

export const completeAssetAudit = withAuth(
  async (
    user,
    { tenant },
    auditId: string,
  ): Promise<AssetAuditActionResult<AssetAuditWithItems> | Denied> => {
    const denied = await denyUnless(user, 'update');
    if (denied) return denied;
    return toAuditResult(async () =>
      (await service()).complete(auditIdSchema.parse(auditId), await serviceContext(tenant, user as { user_id: string })),
    );
  },
);

export const cancelAssetAudit = withAuth(
  async (
    user,
    { tenant },
    auditId: string,
  ): Promise<AssetAuditActionResult<AssetAuditWithItems> | Denied> => {
    const denied = await denyUnless(user, 'update');
    if (denied) return denied;
    return toAuditResult(async () =>
      (await service()).cancel(auditIdSchema.parse(auditId), await serviceContext(tenant, user as { user_id: string })),
    );
  },
);

/**
 * asset:read probe for the client drawer's Audits tab (and therefore the
 * Install base tile's "Site audits" link): the tab hides for a user who cannot
 * read assets instead of opening onto a permission error.
 */
export const hasAssetAuditReadAccess = withAuth(async (user): Promise<boolean> => {
  return hasPermission(user, 'asset', 'read');
});
