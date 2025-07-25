/**
 * Team Permissions API Route
 * GET /api/v1/teams/[id]/permissions - Get team permissions
 * POST /api/v1/teams/[id]/permissions - Grant team permission
 */

import { ApiTeamController } from '@/lib/api/controllers/ApiTeamController';
import { NextRequest } from 'next/server';

const controller = new ApiTeamController();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // List team permissions
  return controller.listPermissions()(request);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Grant team permission
  return controller.grantPermission()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';