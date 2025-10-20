import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';

const controller = new ApiContractLineController();

export const GET = controller.getFixedContractLineConfig();
export const PUT = controller.upsertFixedContractLineConfig();
