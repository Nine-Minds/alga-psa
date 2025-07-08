/**
 * Project Bulk Assign API Route
 * PUT /api/v1/projects/bulk-assign - Bulk assign projects
 */

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const controller = new ApiProjectController();

export const PUT = controller.bulkAssign();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';