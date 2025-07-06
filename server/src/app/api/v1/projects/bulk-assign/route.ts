/**
 * Project Bulk Assign API Route
 * PUT /api/v1/projects/bulk-assign - Bulk assign projects
 */

import { ApiProjectControllerV2 } from '@/lib/api/controllers/ApiProjectControllerV2';

const controller = new ApiProjectControllerV2();

export const PUT = controller.bulkAssign();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';