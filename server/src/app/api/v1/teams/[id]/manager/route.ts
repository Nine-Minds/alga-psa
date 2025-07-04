/**
 * Team Manager API Route
 * PUT /api/v1/teams/{id}/manager - Assign team manager
 */

import { ApiTeamControllerV2 } from '@/lib/api/controllers/ApiTeamControllerV2';

const controller = new ApiTeamControllerV2();

export const PUT = controller.assignManager();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
