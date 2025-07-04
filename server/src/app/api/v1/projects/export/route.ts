/**
 * Project Export API Route
 * GET /api/v1/projects/export - Export projects
 */

import { ApiProjectControllerV2 } from '@/lib/api/controllers/ApiProjectControllerV2';

const controller = new ApiProjectControllerV2();

export const GET = controller.export();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';