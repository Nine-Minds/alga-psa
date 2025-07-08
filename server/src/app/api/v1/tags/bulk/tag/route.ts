import { ApiTagControllerV2 } from '@/lib/api/controllers/ApiTagControllerV2';

export const dynamic = "force-dynamic";

const controller = new ApiTagControllerV2();

export const POST = controller.bulkTagEntities();