/**
 * Team Manager API Route
 * PUT /api/v1/teams/{id}/manager - Assign team manager
 */

import { ApiTeamController } from '@/lib/api/controllers/ApiTeamController';


const controller = new ApiTeamController();
export const PUT = controller.assignManager();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
