/**
 * Site audit service adapter (mobile 2.0 FR16).
 *
 * The lifecycle lives in @alga-psa/assets so the MSP web surfaces and the v1
 * REST API drive the same code (packages cannot import server internals). This
 * adapter only translates the package's refusal codes into the API
 * middleware's NotFoundError / ConflictError, so v1 responses are unchanged.
 */

import { ServiceContext } from '@alga-psa/db';
import {
  AssetAuditService as PackageAssetAuditService,
  type AssetAuditWithItems,
  type CreateAssetAuditInput,
  type MarkAssetAuditItemInput,
} from '@alga-psa/assets/lib/audits/service';
import { isAssetAuditError } from '@alga-psa/assets/lib/audits/errors';
import type { AssetAuditListFilters, AssetAuditRecord } from '@alga-psa/types';
import { ConflictError, NotFoundError } from '../middleware/apiMiddleware';
import type { CreateAssetAuditData, MarkAssetAuditItemData } from '../schemas/assetAudit';

export type {
  AssetAuditItemMethod,
  AssetAuditItemRecord,
  AssetAuditItemResult,
  AssetAuditRecord,
  AssetAuditStatus,
  AssetAuditWithItems,
} from '@alga-psa/types';

/** A package refusal becomes the HTTP error the route layer already renders. */
async function mapErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isAssetAuditError(error)) {
      throw error.code === 'conflict' ? new ConflictError(error.message) : new NotFoundError(error.message);
    }
    throw error;
  }
}

export class AssetAuditService {
  private service = new PackageAssetAuditService();

  async start(data: CreateAssetAuditData, context: ServiceContext): Promise<AssetAuditWithItems> {
    return mapErrors(() => this.service.start(data as CreateAssetAuditInput, context));
  }

  async markItem(
    auditId: string,
    data: MarkAssetAuditItemData,
    context: ServiceContext,
  ): Promise<AssetAuditWithItems> {
    return mapErrors(() => this.service.markItem(auditId, data as MarkAssetAuditItemInput, context));
  }

  async unmarkItem(auditId: string, assetId: string, context: ServiceContext): Promise<AssetAuditWithItems> {
    return mapErrors(() => this.service.unmarkItem(auditId, assetId, context));
  }

  async complete(auditId: string, context: ServiceContext): Promise<AssetAuditWithItems> {
    return mapErrors(() => this.service.complete(auditId, context));
  }

  async cancel(auditId: string, context: ServiceContext): Promise<AssetAuditWithItems> {
    return mapErrors(() => this.service.cancel(auditId, context));
  }

  async get(auditId: string, context: ServiceContext): Promise<AssetAuditWithItems> {
    return mapErrors(() => this.service.get(auditId, context));
  }

  async list(
    options: AssetAuditListFilters,
    context: ServiceContext,
  ): Promise<{ data: AssetAuditRecord[]; total: number }> {
    return mapErrors(() => this.service.list(options, context));
  }
}
