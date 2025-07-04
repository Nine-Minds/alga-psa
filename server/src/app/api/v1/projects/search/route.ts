/**
 * Project Search API Route
 * GET /api/v1/projects/search - Search projects
 */

import { ApiProjectControllerV2 } from '@/lib/api/controllers/ApiProjectControllerV2';

const controller = new ApiProjectControllerV2();

export const GET = controller.search();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';