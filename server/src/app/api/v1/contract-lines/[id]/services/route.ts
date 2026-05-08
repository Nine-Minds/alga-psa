import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiContractLineController();

export const GET = withApiKeyRouteAuth<{ id: string }>(async (request, context) => controller.getContractLineServices()(request, context));
export const POST = withApiKeyRouteAuth<{ id: string }>(async (request, context) => controller.addServiceToContractLine()(request, context));
