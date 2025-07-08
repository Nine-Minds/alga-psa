/**
 * Teams API Route
 * GET /api/v1/teams - List teams
 * POST /api/v1/teams - Create team
 */

import { ApiTeamController } from '@/lib/api/controllers/ApiTeamController';

const controller = new ApiTeamController();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';