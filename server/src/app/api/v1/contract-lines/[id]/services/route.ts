import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';

const controller = new ApiContractLineController();

export const GET = controller.getPlanServices();
export const POST = controller.addServiceToPlan();