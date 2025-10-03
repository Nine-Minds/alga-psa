/**
 * Client Billing Plans API Routes (DEPRECATED)
 * GET /api/v1/client-billing-plans - List client billing plans
 * POST /api/v1/client-billing-plans - Assign plan to client
 *
 * @deprecated This endpoint is deprecated. Use /api/v1/client-billing-plans instead.
 *
 * This endpoint is maintained for backward compatibility during the client → client migration.
 * Please migrate to /api/v1/client-billing-plans as this endpoint will be removed in a future version.
 */

import { ApiBillingPlanController } from '@/lib/api/controllers/ApiBillingPlanController';

export const dynamic = 'force-dynamic';

const controller = new ApiBillingPlanController();

export const GET = controller.listClientBillingPlans();
export const POST = controller.assignPlanToClient();