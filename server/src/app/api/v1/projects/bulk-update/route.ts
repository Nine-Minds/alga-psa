/**
 * Project Bulk Update API Route
 * PUT /api/v1/projects/bulk-update - Bulk update projects
 */

import { ApiProjectControllerV2 } from '@/lib/api/controllers/ApiProjectControllerV2';

const controller = new ApiProjectControllerV2();

export const PUT = controller.bulkUpdate();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';