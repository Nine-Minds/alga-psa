/**
 * Team Hierarchy Management API Route
 * POST /api/v1/teams/[id]/hierarchy - Create hierarchy relationship
 * DELETE /api/v1/teams/[id]/hierarchy - Remove from hierarchy
 */

import { ApiTeamControllerV2 } from 'server/src/lib/api/controllers/ApiTeamControllerV2';
import { NextRequest } from 'next/server';

const controller = new ApiTeamControllerV2();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Create team hierarchy
  return controller.createHierarchy()(request);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Remove team from hierarchy
  return controller.removeFromHierarchy()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';