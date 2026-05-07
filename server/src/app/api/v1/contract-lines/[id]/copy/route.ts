import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiContractLineController();

export const POST = withApiKeyRouteAuth<{ id: string }>(async (request, context) => controller.copyContractLine()(request, context));
