/**
 * Project Export API Route
 * GET /api/v1/projects/export - Export projects
 */

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const controller = new ApiProjectController();

export const GET = controller.export();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';