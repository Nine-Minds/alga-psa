import { NextResponse } from 'next/server';

type RmmRouteError = {
  message: string;
  status: number;
};

const EXPECTED_RMM_MESSAGES: Array<[match: string, response: RmmRouteError]> = [
  ['RMM features require Enterprise Edition', {
    status: 403,
    message: 'RMM features require Enterprise Edition.',
  }],
  ['This feature requires', {
    status: 403,
    message: 'Your current plan does not include RMM features.',
  }],
  ['Asset not found', {
    status: 404,
    message: 'Asset not found. It may have been deleted. Please refresh and try again.',
  }],
  ['Asset is not managed by NinjaOne', {
    status: 404,
    message: 'This asset is not managed by NinjaOne.',
  }],
  ['No active NinjaOne integration found', {
    status: 409,
    message: 'No active NinjaOne integration is configured.',
  }],
  ['requires reconnection', {
    status: 409,
    message: 'The NinjaOne integration needs to be reconnected before this action can run.',
  }],
  ['No refresh token available', {
    status: 409,
    message: 'The NinjaOne integration needs to be reconnected before this action can run.',
  }],
  ['NinjaOne client credentials not configured', {
    status: 409,
    message: 'NinjaOne client credentials are not configured.',
  }],
  ['Sync is already in progress', {
    status: 409,
    message: 'A NinjaOne sync is already in progress. Please try again shortly.',
  }],
  ['No tenant found', {
    status: 401,
    message: 'Tenant context is missing. Please sign in again.',
  }],
];

export function rmmRouteErrorFrom(error: unknown): RmmRouteError | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!message) {
    return null;
  }

  const expected = EXPECTED_RMM_MESSAGES.find(([match]) => message.includes(match));
  return expected?.[1] ?? null;
}

export function rmmErrorResponse(error: RmmRouteError): NextResponse {
  return NextResponse.json({ error: error.message }, { status: error.status });
}
