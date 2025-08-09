/**
 * Team Permission by ID API Route
 * DELETE /api/v1/teams/[id]/permissions/[permissionId] - Revoke team permission
 */

import { ApiTeamController } from '@/lib/api/controllers/ApiTeamController';
import { NextRequest } from 'next/server';

const controller = new ApiTeamController();

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; permissionId: string }> }) {
  // Revoke team permission
  return controller.revokePermission()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';