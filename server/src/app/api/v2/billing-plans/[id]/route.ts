import { ApiBillingPlanControllerV2 } from '@/lib/api/controllers/ApiBillingPlanControllerV2';

const controller = new ApiBillingPlanControllerV2();

export const GET = controller.getById();
export const PUT = controller.update();
export const DELETE = controller.delete();