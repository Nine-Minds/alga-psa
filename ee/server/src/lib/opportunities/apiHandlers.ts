import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { createTenantKnex, runWithTenant, withTransaction } from '@alga-psa/db';
import { TIER_FEATURES } from '@alga-psa/types';
import type { OpportunityPeriod } from '@alga-psa/types';
import { assertTenantTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { ApiBaseController } from 'server/src/lib/api/controllers/ApiBaseController';
import { OpportunityService } from 'server/src/lib/api/services/OpportunityService';
import {
  createSuccessResponse,
  handleApiError,
  ValidationError,
} from 'server/src/lib/api/middleware/apiMiddleware';
import {
  createCommitmentSchema,
  createQbrOpportunitiesSchema,
  opportunityPeriodSchema,
  updateCommitmentSchema,
} from './actions';
import { getForecastBandData, getSellerCalibrationData } from './forecast';
import {
  createCommitmentData,
  deleteCommitmentData,
  getActiveMeetingSessionData,
  listCommitmentsData,
  markDealReviewedData,
  startMeetingSessionData,
  updateCommitmentData,
} from './meetingCommitments';
import {
  createOpportunitiesFromQbrTriggersData,
  getQbrTriggerPackData,
  getQbrYieldData,
} from './qbr';
import { getSellerRollupsData } from './rollups';

export type OpportunityManagementApiOperation =
  | 'forecast'
  | 'calibration'
  | 'meeting-start'
  | 'meeting-active'
  | 'meeting-review'
  | 'commitment-list'
  | 'commitment-create'
  | 'commitment-update'
  | 'commitment-delete'
  | 'qbr-pack'
  | 'qbr-create'
  | 'qbr-yield'
  | 'seller-rollups';

const uuid = z.string().uuid();

function queryObject(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

async function parseBody(request: Request): Promise<unknown> {
  return request.json().catch(() => ({}));
}

function validation<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ValidationError('Validation failed', parsed.error.errors);
  return parsed.data;
}

class OpportunityManagementApiController extends ApiBaseController {
  constructor() {
    super(new OpportunityService(), {
      resource: 'opportunities',
      permissions: { create: 'create', read: 'read', update: 'update', delete: 'delete', list: 'read' },
    });
  }

  async handle(
    operation: OpportunityManagementApiOperation,
    request: Request,
    params: Record<string, string>,
  ): Promise<Response> {
    try {
      const apiRequest = await this.authenticate(request as NextRequest);
      return await runWithTenant(apiRequest.context.tenant, async () => {
        const permission = operation === 'qbr-create'
          ? 'create'
          : operation === 'commitment-delete'
            ? 'delete'
            : ['meeting-review', 'commitment-create', 'commitment-update'].includes(operation)
              ? 'update'
              : 'read';
        await this.checkPermission(apiRequest, permission);
        await assertTenantTierAccess(apiRequest.context.tenant, TIER_FEATURES.OPPORTUNITY_MANAGEMENT);
        const { knex } = await createTenantKnex(apiRequest.context.tenant);
        const actor = apiRequest.context.userId;

        switch (operation) {
          case 'forecast': {
            const period = validation(opportunityPeriodSchema, queryObject(request)) as OpportunityPeriod;
            return createSuccessResponse(await getForecastBandData(knex, apiRequest.context.tenant, period));
          }
          case 'calibration':
            return createSuccessResponse(await getSellerCalibrationData(knex, apiRequest.context.tenant));
          case 'meeting-start':
            return createSuccessResponse(await withTransaction(knex, (trx) => (
              startMeetingSessionData(trx, apiRequest.context.tenant, actor)
            )), 201);
          case 'meeting-active':
            return createSuccessResponse(await getActiveMeetingSessionData(
              knex,
              apiRequest.context.tenant,
              actor,
            ));
          case 'meeting-review': {
            const sessionId = validation(uuid, params.sessionId);
            const body = validation(z.object({
              opportunity_id: uuid,
              note: z.string().trim().max(4000).nullable().optional(),
            }), await parseBody(request));
            return createSuccessResponse(await withTransaction(knex, (trx) => markDealReviewedData(
              trx,
              apiRequest.context.tenant,
              sessionId,
              body.opportunity_id,
              body.note ?? null,
            )));
          }
          case 'commitment-list':
            return createSuccessResponse(await listCommitmentsData(
              knex,
              apiRequest.context.tenant,
              validation(uuid, params.id),
            ));
          case 'commitment-create': {
            const body = validation(createCommitmentSchema, await parseBody(request));
            return createSuccessResponse(await withTransaction(knex, (trx) => createCommitmentData(
              trx,
              apiRequest.context.tenant,
              validation(uuid, params.id),
              body.description,
              actor,
            )), 201);
          }
          case 'commitment-update': {
            const body = validation(updateCommitmentSchema, await parseBody(request));
            return createSuccessResponse(await withTransaction(knex, (trx) => updateCommitmentData(
              trx,
              apiRequest.context.tenant,
              validation(uuid, params.id),
              validation(uuid, params.commitmentId),
              body,
              actor,
            )));
          }
          case 'commitment-delete':
            await withTransaction(knex, (trx) => deleteCommitmentData(
              trx,
              apiRequest.context.tenant,
              validation(uuid, params.id),
              validation(uuid, params.commitmentId),
            ));
            return new Response(null, { status: 204 });
          case 'qbr-pack':
            return createSuccessResponse(await getQbrTriggerPackData(
              knex,
              apiRequest.context.tenant,
              validation(uuid, params.clientId),
            ));
          case 'qbr-create': {
            const body = validation(createQbrOpportunitiesSchema, await parseBody(request));
            return createSuccessResponse(await withTransaction(knex, (trx) => (
              createOpportunitiesFromQbrTriggersData(
                trx,
                apiRequest.context.tenant,
                validation(uuid, params.clientId),
                body.trigger_keys,
                actor,
              )
            )), 201);
          }
          case 'qbr-yield':
            return createSuccessResponse(await getQbrYieldData(knex, apiRequest.context.tenant));
          case 'seller-rollups': {
            const period = validation(opportunityPeriodSchema, queryObject(request)) as OpportunityPeriod;
            return createSuccessResponse(await getSellerRollupsData(knex, apiRequest.context.tenant, period));
          }
        }
      });
    } catch (error) {
      return handleApiError(error);
    }
  }
}

const controller = new OpportunityManagementApiController();

export async function handleOpportunityManagementApi(
  operation: OpportunityManagementApiOperation,
  request: Request,
  params: Record<string, string> = {},
): Promise<Response> {
  return controller.handle(operation, request, params);
}
