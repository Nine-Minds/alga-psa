/**
 * Teams Bulk Operations API Route
 * PUT /api/v1/teams/bulk - Bulk update teams
 * DELETE /api/v1/teams/bulk - Bulk delete teams
 */

import { ApiTeamControllerV2 } from 'server/src/lib/api/controllers/ApiTeamControllerV2';
import { NextRequest } from 'next/server';

const controller = new ApiTeamControllerV2();

export async function PUT(request: NextRequest) {
  // Bulk update teams
  return controller.bulkUpdate()(request);
}

export async function DELETE(request: NextRequest) {
  // Bulk delete teams
  return controller.bulkDelete()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';