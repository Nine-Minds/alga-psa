/**
 * Project Search API Route
 * GET /api/v1/projects/search - Search projects
 */

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const controller = new ApiProjectController();

export const GET = controller.search();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';