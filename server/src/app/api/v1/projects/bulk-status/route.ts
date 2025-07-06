/**
 * Project Bulk Status Update API Route
 * PUT /api/v1/projects/bulk-status - Bulk update project status
 */

import { ApiProjectControllerV2 } from '@/lib/api/controllers/ApiProjectControllerV2';

const controller = new ApiProjectControllerV2();

export const PUT = controller.bulkStatusUpdate();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';