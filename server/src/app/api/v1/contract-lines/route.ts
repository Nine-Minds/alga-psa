import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';
import { withApiKeyRouteAuth } from '@/lib/api/middleware/withApiKeyRouteAuth';

export const dynamic = 'force-dynamic';

const controller = new ApiContractLineController();

export const GET = withApiKeyRouteAuth(async (request) => controller.list()(request));
export const POST = withApiKeyRouteAuth(async (request) => controller.create()(request));
