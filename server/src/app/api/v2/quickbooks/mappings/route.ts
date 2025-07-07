import { ApiQuickBooksControllerV2 } from '@/lib/api/controllers/ApiQuickBooksControllerV2';

const controller = new ApiQuickBooksControllerV2();

export const GET = controller.getDataMappings();
export const POST = controller.createDataMapping();