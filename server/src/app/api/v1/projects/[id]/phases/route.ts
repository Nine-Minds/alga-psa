/**
 * Project Phases API Routes
 * GET /api/v1/projects/{id}/phases - List project phases
 * POST /api/v1/projects/{id}/phases - Create project phase
 */

import { ApiProjectControllerV2 } from '@/lib/api/controllers/ApiProjectControllerV2';

const controller = new ApiProjectControllerV2();

export const GET = controller.listPhases();
export const POST = controller.createPhase();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';