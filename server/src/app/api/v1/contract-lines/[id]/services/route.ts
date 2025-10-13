import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';

const controller = new ApiContractLineController();

export const GET = controller.getContractLineServices();
export const POST = controller.addServiceToContractLine();
