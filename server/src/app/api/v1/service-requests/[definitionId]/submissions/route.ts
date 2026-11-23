/**
 * Service Request Submissions API Route
 * POST /api/v1/service-requests/{definitionId}/submissions - submit on behalf of a client contact
 */

import { ApiServiceRequestController } from '@/lib/api/controllers/ApiServiceRequestController';

const controller = new ApiServiceRequestController();

export const POST = controller.submit();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
