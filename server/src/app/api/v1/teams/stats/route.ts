/**
 * Team Statistics API Route
 * GET /api/v1/teams/stats - Get team statistics
 */

import { ApiTeamControllerV2 } from '@/lib/api/controllers/ApiTeamControllerV2';

const controller = new ApiTeamControllerV2();

export const GET = controller.stats();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
