/**
 * Team Analytics API Route
 * GET /api/v1/teams/{id}/analytics - Get team analytics
 */

import { ApiTeamController } from '@/lib/api/controllers/ApiTeamController';


const controller = new ApiTeamController();
export const GET = controller.getAnalytics();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
