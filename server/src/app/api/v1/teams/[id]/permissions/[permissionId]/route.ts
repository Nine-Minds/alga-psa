/**
 * Team Permission by ID API Route
 * DELETE /api/v1/teams/[id]/permissions/[permissionId] - Revoke team permission
 */

import { ApiTeamControllerV2 } from '@/lib/api/controllers/ApiTeamControllerV2';
import { NextRequest } from 'next/server';

const controller = new ApiTeamControllerV2();

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; permissionId: string }> }) {
  // Revoke team permission
  return controller.revokePermission()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';