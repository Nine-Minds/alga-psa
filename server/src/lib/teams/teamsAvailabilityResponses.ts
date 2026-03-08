import type { TeamsAvailability } from '@alga-psa/integrations/lib/teamsAvailability';
import { NextResponse } from 'next/server';

export function getTeamsAvailabilityHttpStatus(availability: TeamsAvailability): number {
  return availability.reason === 'ce_unavailable' ? 501 : 404;
}

export function buildTeamsAvailabilityJsonResponse(availability: TeamsAvailability): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: availability.message,
      reason: availability.reason,
    },
    { status: getTeamsAvailabilityHttpStatus(availability) }
  );
}
