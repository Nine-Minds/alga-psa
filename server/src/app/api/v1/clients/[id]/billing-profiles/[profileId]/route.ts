/**
 * Client Billing Profile API Route
 * GET /api/v1/clients/{id}/billing-profiles/{profileId} - get one billing profile
 */

import { ApiClientController } from '@/lib/api/controllers/ApiClientController';

const controller = new ApiClientController();

export const GET = controller.getBillingProfile();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
