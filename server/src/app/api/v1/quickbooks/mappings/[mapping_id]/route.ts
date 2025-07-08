import { ApiQuickBooksControllerV2 } from '@/lib/api/controllers/ApiQuickBooksControllerV2';

export const dynamic = "force-dynamic";

const controller = new ApiQuickBooksControllerV2();

export const GET = controller.getDataMappingById();
export const PUT = controller.updateDataMapping();
export const DELETE = controller.deleteDataMapping();