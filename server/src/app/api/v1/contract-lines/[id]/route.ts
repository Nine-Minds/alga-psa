import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

const controller = new ApiContractLineController();

export const GET = withApiKeyRouteAuth<{ id: string }>(async (request, context) => controller.getById()(request, context));
export const PUT = withApiKeyRouteAuth<{ id: string }>(async (request, context) => controller.update()(request, context));
export const DELETE = withApiKeyRouteAuth<{ id: string }>(async (request, context) => controller.delete()(request, context));
