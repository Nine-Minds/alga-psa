/**
 * Team Hierarchy API Route
 * GET /api/v1/teams/hierarchy - Get team hierarchy
 */

import { ApiTeamController } from '@/lib/api/controllers/ApiTeamController';

const controller = new ApiTeamController();

export const GET = controller.getHierarchy();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
