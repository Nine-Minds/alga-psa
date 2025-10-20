import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';

const controller = new ApiContractLineController();

export const DELETE = controller.bulkDeleteContractLines();
