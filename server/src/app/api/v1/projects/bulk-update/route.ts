/**
 * Project Bulk Update API Route
 * PUT /api/v1/projects/bulk-update - Bulk update projects
 */

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const controller = new ApiProjectController();

export const PUT = controller.bulkUpdate();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';