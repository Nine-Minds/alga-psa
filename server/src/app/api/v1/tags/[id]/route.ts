import { ApiTagController } from '@/lib/api/controllers/ApiTagController';

export const dynamic = "force-dynamic";

const controller = new ApiTagController();

export const GET = controller.read();
export const PUT = controller.update();
export const DELETE = controller.delete();