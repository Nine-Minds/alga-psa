import { ApiTagControllerV2 } from '@/lib/api/controllers/ApiTagControllerV2';

const controller = new ApiTagControllerV2();

export const GET = controller.read();
export const PUT = controller.update();
export const DELETE = controller.delete();