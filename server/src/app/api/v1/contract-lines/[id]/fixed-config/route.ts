import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';

const controller = new ApiContractLineController();

export const GET = controller.getFixedPlanConfig();
export const PUT = controller.upsertFixedPlanConfig();