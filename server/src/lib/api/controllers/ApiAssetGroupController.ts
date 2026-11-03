/**
 * Asset group API controller (FR-E9).
 *
 * The group model lives in `@alga-psa/assets/lib/assetGroups`, which is also
 * what the server actions call — so the REST surface and the UI enforce the
 * same invariants. A violation (client mismatch, already grouped, owner on a
 * workspace…) is a 400 with the model's own message, because each one is the
 * caller asking for something the two kinds do not mean.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTransaction, tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import {
  addAssetsToGroupRows,
  addGroupUser,
  createGroup,
  deleteGroupRow,
  getGroupOwnerId,
  getGroupWithDetails,
  isAssetGroupError,
  listGroupsForClient,
  removeAssetFromGroupRow,
  removeGroupUser,
  setGroupOwner,
  updateGroupRow,
} from '@alga-psa/assets/lib/assetGroups';
import { createApiResponse, createErrorResponse } from '../utils/response';
import { requireRequestContext } from '../utils/requestContext';
import { ApiContext } from '../middleware/apiMiddleware';
import { hasPermission } from '../../auth/rbac';
import { getConnection } from '../../db/db';
import { uuidSchema } from '../schemas/common';

const groupKindSchema = z.enum(['bundle', 'shared_workspace']);

export const createAssetGroupSchema = z.object({
  client_id: uuidSchema,
  name: z.string().min(1, 'Group name is required').max(255),
  kind: groupKindSchema,
  location_id: uuidSchema.nullable().optional(),
  description: z.string().nullable().optional(),
  asset_ids: z.array(uuidSchema).optional(),
});

export const updateAssetGroupSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  kind: groupKindSchema.optional(),
  location_id: uuidSchema.nullable().optional(),
  description: z.string().nullable().optional(),
});

export const assetGroupMembersSchema = z.object({
  asset_ids: z.array(uuidSchema).min(1, 'At least one asset is required'),
});

export const assetGroupContactSchema = z.object({
  contact_name_id: uuidSchema.nullable(),
  role: z.enum(['owner', 'user']),
});

export class ApiAssetGroupController {
  private async requireContext(
    req: NextRequest,
    action: 'read' | 'create' | 'update' | 'delete'
  ): Promise<ApiContext | NextResponse> {
    const context = requireRequestContext(req);
    if (!context.user) {
      return createErrorResponse('User context required', 401, 'UNAUTHORIZED');
    }
    const knex = await getConnection(context.tenant);
    if (!(await hasPermission(context.user, 'asset', action, knex))) {
      return createErrorResponse(`Permission denied: Cannot ${action} asset`, 403, 'FORBIDDEN');
    }
    return context;
  }

  private async run<T>(context: ApiContext, work: (trx: Knex.Transaction) => Promise<T>): Promise<NextResponse> {
    const knex = await getConnection(context.tenant);
    try {
      const result = await withTransaction(knex, (trx: Knex.Transaction) => work(trx));
      return createApiResponse(result);
    } catch (error) {
      if (isAssetGroupError(error)) {
        // A group that is not there is a 404 wherever it is asked for, not
        // only on GET.
        const status = error.code === 'not_found' ? 404 : 400;
        return createErrorResponse(error.message, status, error.code.toUpperCase());
      }
      if (error instanceof Error && error.name === 'AssetAssigneeError') {
        return createErrorResponse(error.message, 400, 'ASSIGNEE_NOT_ALLOWED');
      }
      throw error;
    }
  }

  /** GET /api/v1/asset-groups?client_id=… */
  async list(req: NextRequest): Promise<NextResponse> {
    const context = await this.requireContext(req, 'read');
    if (context instanceof NextResponse) return context;

    const clientId = new URL(req.url).searchParams.get('client_id');
    const parsed = uuidSchema.safeParse(clientId);
    if (!parsed.success) {
      return createErrorResponse('client_id is required', 400, 'VALIDATION_ERROR');
    }

    const knex = await getConnection(context.tenant);
    return createApiResponse(await listGroupsForClient(knex, context.tenant, parsed.data));
  }

  /** POST /api/v1/asset-groups */
  async create(req: NextRequest): Promise<NextResponse> {
    const context = await this.requireContext(req, 'create');
    if (context instanceof NextResponse) return context;

    const parsed = createAssetGroupSchema.safeParse(await req.json());
    if (!parsed.success) {
      return createErrorResponse('Validation failed', 400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    return this.run(context, async (trx) => {
      const group = await createGroup(trx, context.tenant, {
        clientId: parsed.data.client_id,
        name: parsed.data.name,
        kind: parsed.data.kind,
        locationId: parsed.data.location_id ?? null,
        description: parsed.data.description ?? null,
        actorUserId: context.userId ?? null,
      });
      if (parsed.data.asset_ids?.length) {
        await addAssetsToGroupRows(trx, context.tenant, group.group_id, parsed.data.asset_ids, {
          actorUserId: context.userId ?? null,
        });
      }
      return getGroupWithDetails(trx, context.tenant, group.group_id);
    });
  }

  /** GET /api/v1/asset-groups/{id} */
  async getById(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireContext(req, 'read');
    if (context instanceof NextResponse) return context;

    const knex = await getConnection(context.tenant);
    try {
      return createApiResponse(await getGroupWithDetails(knex, context.tenant, params.id));
    } catch (error) {
      if (isAssetGroupError(error) && error.code === 'not_found') {
        return createErrorResponse('Asset group not found', 404, 'NOT_FOUND');
      }
      throw error;
    }
  }

  /** PUT /api/v1/asset-groups/{id} */
  async update(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireContext(req, 'update');
    if (context instanceof NextResponse) return context;

    const parsed = updateAssetGroupSchema.safeParse(await req.json());
    if (!parsed.success) {
      return createErrorResponse('Validation failed', 400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    return this.run(context, async (trx) => {
      await updateGroupRow(trx, context.tenant, params.id, {
        name: parsed.data.name,
        kind: parsed.data.kind,
        locationId: parsed.data.location_id,
        description: parsed.data.description,
        actorUserId: context.userId ?? null,
      });
      return getGroupWithDetails(trx, context.tenant, params.id);
    });
  }

  /** DELETE /api/v1/asset-groups/{id} */
  async delete(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireContext(req, 'delete');
    if (context instanceof NextResponse) return context;

    return this.run(context, async (trx) => {
      await deleteGroupRow(trx, context.tenant, params.id, { actorUserId: context.userId ?? null });
      return { success: true };
    });
  }

  /** POST /api/v1/asset-groups/{id}/members */
  async addMembers(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireContext(req, 'update');
    if (context instanceof NextResponse) return context;

    const parsed = assetGroupMembersSchema.safeParse(await req.json());
    if (!parsed.success) {
      return createErrorResponse('Validation failed', 400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    return this.run(context, async (trx) => {
      await addAssetsToGroupRows(trx, context.tenant, params.id, parsed.data.asset_ids, {
        actorUserId: context.userId ?? null,
      });
      return getGroupWithDetails(trx, context.tenant, params.id);
    });
  }

  /** DELETE /api/v1/asset-groups/{id}/members?asset_id=… */
  async removeMember(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireContext(req, 'update');
    if (context instanceof NextResponse) return context;

    const assetId = uuidSchema.safeParse(new URL(req.url).searchParams.get('asset_id'));
    if (!assetId.success) {
      return createErrorResponse('asset_id is required', 400, 'VALIDATION_ERROR');
    }

    return this.run(context, async (trx) => {
      await removeAssetFromGroupRow(trx, context.tenant, params.id, assetId.data, {
        actorUserId: context.userId ?? null,
      });
      return getGroupWithDetails(trx, context.tenant, params.id);
    });
  }

  /** POST /api/v1/asset-groups/{id}/contacts */
  async addContact(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireContext(req, 'update');
    if (context instanceof NextResponse) return context;

    const parsed = assetGroupContactSchema.safeParse(await req.json());
    if (!parsed.success) {
      return createErrorResponse('Validation failed', 400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    return this.run(context, async (trx) => {
      if (parsed.data.role === 'owner') {
        await setGroupOwner(trx, context.tenant, params.id, parsed.data.contact_name_id, {
          actorUserId: context.userId ?? null,
        });
      } else {
        if (!parsed.data.contact_name_id) {
          throw Object.assign(new Error('contact_name_id is required for a user'), { name: 'AssetAssigneeError' });
        }
        await addGroupUser(trx, context.tenant, params.id, parsed.data.contact_name_id);
      }
      return getGroupWithDetails(trx, context.tenant, params.id);
    });
  }

  /** DELETE /api/v1/asset-groups/{id}/contacts?contact_name_id=… */
  async removeContact(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireContext(req, 'update');
    if (context instanceof NextResponse) return context;

    const contactId = uuidSchema.safeParse(new URL(req.url).searchParams.get('contact_name_id'));
    if (!contactId.success) {
      return createErrorResponse('contact_name_id is required', 400, 'VALIDATION_ERROR');
    }

    const knex = await getConnection(context.tenant);
    const group = await tenantDb(knex, context.tenant).table('asset_groups')
      .where({ group_id: params.id })
      .first('kind');
    const isBundle = group?.kind === 'bundle';
    if (isBundle) {
      // A bundle has one owner, but the caller still has to name the right
      // one: silently clearing whoever happens to be there is not what
      // "remove this contact" asked for.
      const owner = await getGroupOwnerId(knex, context.tenant, params.id);
      if (owner && owner !== contactId.data) {
        return createErrorResponse('contact_name_id is not the owner of this bundle', 400, 'VALIDATION_ERROR');
      }
    }

    return this.run(context, async (trx) => {
      if (isBundle) {
        await setGroupOwner(trx, context.tenant, params.id, null, { actorUserId: context.userId ?? null });
      } else {
        await removeGroupUser(trx, context.tenant, params.id, contactId.data);
      }
      return getGroupWithDetails(trx, context.tenant, params.id);
    });
  }
}
