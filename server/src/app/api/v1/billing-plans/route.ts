import { ApiBillingPlanControllerV2 } from '@/lib/api/controllers/ApiBillingPlanControllerV2';

export const dynamic = 'force-dynamic';

const controller = new ApiBillingPlanControllerV2();

export const GET = controller.list();
export const POST = controller.create();