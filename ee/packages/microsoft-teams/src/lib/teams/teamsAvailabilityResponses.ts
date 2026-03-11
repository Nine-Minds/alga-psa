import type { TeamsAvailability } from './teamsAvailability';
import { NextResponse } from 'next/server';

export function getTeamsAvailabilityHttpStatus(availability: TeamsAvailability): number {
  return availability.reason === 'ce_unavailable' ? 501 : 404;
}

export function buildTeamsAvailabilityJsonResponse(availability: TeamsAvailability): NextResponse {
  const errorMessage =
    availability.enabled === false
      ? availability.message
      : 'Microsoft Teams integration is unavailable.';

  return NextResponse.json(
    {
      success: false,
      error: errorMessage,
      reason: availability.reason,
    },
    { status: getTeamsAvailabilityHttpStatus(availability) }
  );
}
