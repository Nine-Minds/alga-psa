import { ApiTagControllerV2 } from '@/lib/api/controllers/ApiTagControllerV2';

const controller = new ApiTagControllerV2();

export const POST = controller.bulkCreateTags();
export const DELETE = controller.bulkDeleteTags();