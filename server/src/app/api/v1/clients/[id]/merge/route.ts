/**
 * Client Merge API Route
 * POST /api/v1/clients/{id}/merge - absorb another client into this one as a billing profile
 */

import { ApiClientController } from '@/lib/api/controllers/ApiClientController';

const controller = new ApiClientController();

export const POST = controller.merge();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
