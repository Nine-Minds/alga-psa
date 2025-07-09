import { ApiQuickBooksController } from '@/lib/api/controllers/ApiQuickBooksController';

export const dynamic = "force-dynamic";

const controller = new ApiQuickBooksController();

export const GET = controller.getHealthConfig();
export const PUT = controller.updateHealthConfig();