/**
 * Client Billing Plan by ID API Routes (DEPRECATED)
 * DELETE /api/v1/client-billing-plans/{id} - Unassign plan from client
 *
 * @deprecated This endpoint is deprecated. Use /api/v1/client-billing-plans/{id} instead.
 *
 * This endpoint is maintained for backward compatibility during the client → client migration.
 * Please migrate to /api/v1/client-billing-plans/{id} as this endpoint will be removed in a future version.
 */

import { ApiBillingPlanController } from '@/lib/api/controllers/ApiBillingPlanController';

const controller = new ApiBillingPlanController();

export const DELETE = controller.unassignPlanFromClient();