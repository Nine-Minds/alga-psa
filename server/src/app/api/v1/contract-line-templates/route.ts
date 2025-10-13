import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';

export const dynamic = 'force-dynamic';

const controller = new ApiContractLineController();

export const POST = controller.createTemplate();