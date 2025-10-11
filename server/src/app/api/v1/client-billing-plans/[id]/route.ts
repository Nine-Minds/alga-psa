/**
 * Client Billing Plan by ID API Routes
 * DELETE /api/v1/client-billing-plans/{id} - Unassign plan from client
 *
 * This is the new endpoint for client billing plan management.
 * Old /api/v1/client-billing-plans/{id} endpoint is deprecated but still supported.
 */

import { ApiBillingPlanController } from '@/lib/api/controllers/ApiBillingPlanController';

const controller = new ApiBillingPlanController();

export const DELETE = controller.unassignPlanFromClient();
