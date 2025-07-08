import { ApiBillingPlanController } from '@/lib/api/controllers/ApiBillingPlanController';

const controller = new ApiBillingPlanController();

export const GET = controller.getById();
export const PUT = controller.update();
export const DELETE = controller.delete();