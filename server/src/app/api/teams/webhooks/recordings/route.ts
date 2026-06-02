import { NextRequest } from 'next/server';
import { isEnterpriseEdition, eeUnavailable } from '../../_ceStub';
import { teamsOptionsResponse } from '../../_eeDelegator';
import { scheduleImmediateJob } from '@/lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validationResponse(token: string): Response {
  return new Response(token, {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  });
}

function parseTenantFromClientState(clientState: unknown): string | null {
  if (typeof clientState !== 'string') {
    return null;
  }

  return clientState.match(/^teams-online-meeting-artifacts:([^:]+):(recordings|transcripts)$/)?.[1] ?? null;
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!isEnterpriseEdition) {
    return eeUnavailable();
  }

  const validationToken = request.nextUrl.searchParams.get('validationToken');
  if (validationToken) {
    return validationResponse(validationToken);
  }

  return new Response('OK', { status: 200 });
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isEnterpriseEdition) {
    return eeUnavailable();
  }

  const validationToken = request.nextUrl.searchParams.get('validationToken');
  if (validationToken) {
    return validationResponse(validationToken);
  }

  const payload = await request.json().catch(() => ({}));
  const notifications = Array.isArray((payload as any).value) ? (payload as any).value : [];

  for (const notification of notifications) {
    const tenantId = parseTenantFromClientState(notification?.clientState);
    if (!tenantId) {
      continue;
    }

    await scheduleImmediateJob('process-teams-meeting-artifact-notification', {
      tenantId,
      notification,
    });
  }

  return new Response(null, { status: 202 });
}

export async function OPTIONS(): Promise<Response> {
  return teamsOptionsResponse('GET, POST, OPTIONS');
}
