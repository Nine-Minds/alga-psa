/**
 * Team Hierarchy Management API Route
 * POST /api/v1/teams/[id]/hierarchy - Create hierarchy relationship
 * DELETE /api/v1/teams/[id]/hierarchy - Remove from hierarchy
 */

import { ApiTeamController } from '@/lib/api/controllers/ApiTeamController';
import { NextRequest } from 'next/server';

const controller = new ApiTeamController();

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