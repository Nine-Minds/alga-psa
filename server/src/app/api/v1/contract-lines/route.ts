import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

export const dynamic = 'force-dynamic';

const controller = new ApiContractLineController();

export const GET = withApiKeyRouteAuth(async (request, context) => controller.list()(request, context));
export const POST = withApiKeyRouteAuth(async (request, context) => controller.create()(request, context));
