import { ApiBillingPlanController } from '@/lib/api/controllers/ApiBillingPlanController';

const controller = new ApiBillingPlanController();

export const GET = controller.getFixedPlanConfig();
export const PUT = controller.upsertFixedPlanConfig();