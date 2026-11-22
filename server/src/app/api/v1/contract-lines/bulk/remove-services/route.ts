import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiContractLineController();

export const DELETE = withApiKeyRouteAuth(async (request) => controller.bulkRemoveServicesFromContractLine()(request));

// Alias for clients that cannot attach a body to a DELETE (our own agent tooling
// strips it), mirroring POST /api/v1/invoices/bulk/delete.
export const POST = DELETE;
