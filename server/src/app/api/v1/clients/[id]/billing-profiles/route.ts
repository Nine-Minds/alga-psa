/**
 * Client Billing Profiles API Route
 * GET /api/v1/clients/{id}/billing-profiles - list the client's billing profiles
 */

import { ApiClientController } from '@/lib/api/controllers/ApiClientController';

const controller = new ApiClientController();

export const GET = controller.listBillingProfiles();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
