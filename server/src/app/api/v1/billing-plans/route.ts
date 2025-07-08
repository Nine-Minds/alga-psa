import { ApiBillingPlanController } from '@/lib/api/controllers/ApiBillingPlanController';

export const dynamic = 'force-dynamic';

const controller = new ApiBillingPlanController();

export const GET = controller.list();
export const POST = controller.create();