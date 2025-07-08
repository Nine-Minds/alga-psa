import { ApiTagController } from '@/lib/api/controllers/ApiTagController';

export const dynamic = "force-dynamic";

const controller = new ApiTagController();

export const DELETE = controller.deleteByText();