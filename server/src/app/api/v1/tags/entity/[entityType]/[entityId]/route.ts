import { ApiTagController } from '@/lib/api/controllers/ApiTagController';

export const dynamic = "force-dynamic";

const controller = new ApiTagController();

export const GET = controller.getEntityTags();
export const POST = controller.tagEntity();
export const PUT = controller.replaceEntityTags();
export const DELETE = controller.untagEntity();
