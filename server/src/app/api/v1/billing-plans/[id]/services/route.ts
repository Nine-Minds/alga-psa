import { ApiBillingPlanController } from '@/lib/api/controllers/ApiBillingPlanController';

const controller = new ApiBillingPlanController();

export const GET = controller.getPlanServices();
export const POST = controller.addServiceToPlan();