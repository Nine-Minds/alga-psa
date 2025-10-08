import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';

const controller = new ApiContractLineController();

export const GET = controller.getById();
export const PUT = controller.update();
export const DELETE = controller.delete();