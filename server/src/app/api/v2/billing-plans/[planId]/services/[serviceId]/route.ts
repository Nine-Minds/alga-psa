import { ApiBillingPlanControllerV2 } from '@/lib/api/controllers/ApiBillingPlanControllerV2';

const controller = new ApiBillingPlanControllerV2();

export const PUT = controller.updatePlanService();
export const DELETE = controller.removeServiceFromPlan();