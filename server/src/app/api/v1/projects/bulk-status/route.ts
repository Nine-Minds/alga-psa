/**
 * Project Bulk Status Update API Route
 * PUT /api/v1/projects/bulk-status - Bulk update project status
 */

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const controller = new ApiProjectController();

export const PUT = controller.bulkStatusUpdate();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';