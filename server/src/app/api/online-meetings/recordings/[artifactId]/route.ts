import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from '@alga-psa/db';
import { isEnterprise } from '@alga-psa/core/features';
import { getCurrentUser } from '@alga-psa/user-composition/actions';

type EeTeamsMeetingModule = {
  resolveTeamsMeetingGraphConfig?: (tenantId: string) => Promise<{
    clientId: string;
    clientSecret: string;
    microsoftTenantId: string;
  } | null>;
  fetchMicrosoftGraphAppToken?: (input: {
    tenantAuthority: string;
    clientId: string;
    clientSecret: string;
  }) => Promise<string>;
};

async function loadEeTeamsMeetingModule(): Promise<EeTeamsMeetingModule> {
  try {
    return (await import('@alga-psa/ee-microsoft-teams/lib')) as EeTeamsMeetingModule;
  } catch (error) {
    console.warn('[OnlineMeetingRecordingProxy] EE Teams module unavailable', error);
    return {};
  }
}

async function portalVisibilityEnabled(knex: any, tenant: string): Promise<boolean> {
  try {
    const row = await knex('teams_integrations')
      .where({ tenant })
      .first('expose_recordings_in_portal');
    return row?.expose_recordings_in_portal === true;
  } catch {
    return false;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  if (!isEnterprise) {
    return new NextResponse('Teams recording proxy is available in Enterprise Edition only', { status: 404 });
  }

  const { artifactId } = await params;
  if (!artifactId) {
    return new NextResponse('Artifact ID is required', { status: 400 });
  }

  const user = await getCurrentUser().catch(() => null);
  const tenant = (user as any)?.tenant;
  if (!user || !tenant) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { knex } = await createTenantKnex(tenant);

  if (request.nextUrl.searchParams.get('portal') === 'true' && !(await portalVisibilityEnabled(knex, tenant))) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const artifact = await knex('online_meeting_artifacts as artifact')
    .join('online_meetings as meeting', function joinMeeting() {
      this.on('artifact.tenant', '=', 'meeting.tenant')
        .andOn('artifact.meeting_id', '=', 'meeting.meeting_id');
    })
    .where({
      'artifact.tenant': tenant,
      'artifact.artifact_id': artifactId,
      'artifact.artifact_type': 'recording',
    })
    .first(
      'artifact.content_url',
      'artifact.provider_artifact_id',
      'meeting.meeting_id',
    );

  if (!artifact) {
    return new NextResponse('Recording not found', { status: 404 });
  }

  if (!artifact.content_url) {
    return new NextResponse('Recording content is unavailable', { status: 404 });
  }

  const ee = await loadEeTeamsMeetingModule();
  if (!ee.resolveTeamsMeetingGraphConfig || !ee.fetchMicrosoftGraphAppToken) {
    return new NextResponse('Teams recording proxy is unavailable', { status: 503 });
  }

  const config = await ee.resolveTeamsMeetingGraphConfig(tenant);
  if (!config) {
    return new NextResponse('Teams integration is not configured', { status: 503 });
  }

  const accessToken = await ee.fetchMicrosoftGraphAppToken({
    tenantAuthority: config.microsoftTenantId,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  const graphHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  const range = request.headers.get('range');
  if (range) {
    graphHeaders.Range = range;
  }

  const graphResponse = await fetch(artifact.content_url, {
    method: 'GET',
    headers: graphHeaders,
  });

  if (!graphResponse.ok || !graphResponse.body) {
    return new NextResponse('Failed to fetch recording content', { status: graphResponse.status || 502 });
  }

  const headers = new Headers();
  const contentType = graphResponse.headers.get('content-type') || 'video/mp4';
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'private, no-store');
  const contentLength = graphResponse.headers.get('content-length');
  if (contentLength) {
    headers.set('Content-Length', contentLength);
  }
  const contentRange = graphResponse.headers.get('content-range');
  if (contentRange) {
    headers.set('Content-Range', contentRange);
  }
  const acceptRanges = graphResponse.headers.get('accept-ranges');
  if (acceptRanges) {
    headers.set('Accept-Ranges', acceptRanges);
  }
  headers.set(
    'Content-Disposition',
    `attachment; filename="teams-recording-${artifact.provider_artifact_id}.mp4"`,
  );

  return new NextResponse(graphResponse.body as any, {
    status: graphResponse.status,
    headers,
  });
}

export const dynamic = 'force-dynamic';
