import { ApiBillingPlanController } from '@/lib/api/controllers/ApiBillingPlanController';

const controller = new ApiBillingPlanController();

export const POST = controller.addPlanToBundle();