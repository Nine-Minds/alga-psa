import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiContractLineController();

export const POST = withApiKeyRouteAuth(async (request, context) => controller.bulkCreateContractLines()(request, context));
