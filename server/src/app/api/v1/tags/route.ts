import { ApiTagController } from '@/lib/api/controllers/ApiTagController';

export const dynamic = 'force-dynamic';

const controller = new ApiTagController();

export const GET = controller.list();
export const POST = controller.create();