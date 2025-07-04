/**
 * Project Statistics API Route
 * GET /api/v1/projects/stats - Get project statistics
 */

import { ApiProjectControllerV2 } from '@/lib/api/controllers/ApiProjectControllerV2';

const controller = new ApiProjectControllerV2();

export const GET = controller.stats();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';