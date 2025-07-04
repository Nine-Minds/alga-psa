/**
 * Team Analytics API Route
 * GET /api/v1/teams/{id}/analytics - Get team analytics
 */

import { ApiTeamControllerV2 } from '@/lib/api/controllers/ApiTeamControllerV2';

const controller = new ApiTeamControllerV2();

export const GET = controller.getAnalytics();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
