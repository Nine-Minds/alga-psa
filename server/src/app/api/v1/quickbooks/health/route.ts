import { ApiQuickBooksController } from '@/lib/api/controllers/ApiQuickBooksController';

export const dynamic = "force-dynamic";

const controller = new ApiQuickBooksController();

export const GET = controller.getHealth();