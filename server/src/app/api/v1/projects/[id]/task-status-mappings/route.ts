import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const controller = new ApiProjectController();

export const GET = controller.getTaskStatusMappings();
