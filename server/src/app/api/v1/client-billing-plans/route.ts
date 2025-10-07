/**
 * Client Billing Plans API Routes
 * GET /api/v1/client-billing-plans - List client billing plans
 * POST /api/v1/client-billing-plans - Assign plan to client
 *
 * This is the new endpoint for client billing plans.
 * Old /api/v1/client-billing-plans endpoint is deprecated but still supported.
 */

import { ApiBillingPlanController } from '@/lib/api/controllers/ApiBillingPlanController';

export const dynamic = 'force-dynamic';

const controller = new ApiBillingPlanController();

export const GET = controller.listClientBillingPlans();
export const POST = controller.assignPlanToClient();
