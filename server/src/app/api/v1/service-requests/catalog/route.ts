/**
 * Service Request Catalog API Route
 * GET /api/v1/service-requests/catalog?clientId=&contactId= - the contact's visible catalog
 */

import { ApiServiceRequestController } from '@/lib/api/controllers/ApiServiceRequestController';

const controller = new ApiServiceRequestController();

export const GET = controller.catalog();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
