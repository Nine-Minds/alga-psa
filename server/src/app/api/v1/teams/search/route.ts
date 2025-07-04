/**
 * Teams Search API Route
 * GET /api/v1/teams/search - Search teams
 */

import { ApiTeamControllerV2 } from '@/lib/api/controllers/ApiTeamControllerV2';

const controller = new ApiTeamControllerV2();

export const GET = controller.search();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';