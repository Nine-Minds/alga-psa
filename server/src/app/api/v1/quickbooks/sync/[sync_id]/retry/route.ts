import { ApiQuickBooksControllerV2 } from '@/lib/api/controllers/ApiQuickBooksControllerV2';

const controller = new ApiQuickBooksControllerV2();

export const POST = controller.retrySync();