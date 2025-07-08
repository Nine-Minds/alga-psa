import { ApiQuickBooksController } from '@/lib/api/controllers/ApiQuickBooksController';

export const dynamic = "force-dynamic";

const controller = new ApiQuickBooksController();

export const GET = controller.getDataMappingById();
export const PUT = controller.updateDataMapping();
export const DELETE = controller.deleteDataMapping();