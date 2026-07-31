import { ApiMobileCapabilitiesController } from 'server/src/lib/api/controllers/ApiMobileCapabilitiesController';

const controller = new ApiMobileCapabilitiesController();

export async function GET(request: Request) {
  return controller.getMyCapabilities()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
