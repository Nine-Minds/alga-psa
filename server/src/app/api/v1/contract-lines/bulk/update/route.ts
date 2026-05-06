import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiContractLineController();

export const PUT = withApiKeyRouteAuth(async (request) => controller.bulkUpdateContractLines()(request));
