import { NextResponse } from 'next/server';
import { getTeamsAppPackageStatus } from '@alga-psa/integrations/actions';
import { TEAMS_AVAILABILITY_MESSAGES } from '@alga-psa/integrations/lib/teamsAvailability';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function statusForPackageResult(error?: string): number {
  if (error === TEAMS_AVAILABILITY_MESSAGES.flag_disabled) {
    return 404;
  }

  if (error === 'Forbidden') {
    return 403;
  }

  if (error === TEAMS_AVAILABILITY_MESSAGES.ce_unavailable) {
    return 501;
  }

  return 400;
}

async function buildPackageStatusResponse(): Promise<Response> {
  const result = await getTeamsAppPackageStatus();

  return NextResponse.json(result, {
    status: result.success ? 200 : statusForPackageResult(result.error),
  });
}

export async function GET(): Promise<Response> {
  return buildPackageStatusResponse();
}

export async function POST(): Promise<Response> {
  return buildPackageStatusResponse();
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: 'GET, POST, OPTIONS',
    },
  });
}
