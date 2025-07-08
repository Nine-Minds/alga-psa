/**
 * Teams Search API Route
 * GET /api/v1/teams/search - Search teams
 */

import { ApiTeamController } from '@/lib/api/controllers/ApiTeamController';

const controller = new ApiTeamController();

export const GET = controller.search();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';