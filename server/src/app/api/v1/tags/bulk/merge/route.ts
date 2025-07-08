import { ApiTagController } from '@/lib/api/controllers/ApiTagController';

export const dynamic = "force-dynamic";

const controller = new ApiTagController();

export const POST = controller.bulkMergeTags();