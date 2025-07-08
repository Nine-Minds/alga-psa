import { ApiBillingPlanController } from '@/lib/api/controllers/ApiBillingPlanController';

const controller = new ApiBillingPlanController();

export const PUT = controller.bulkUpdatePlans();