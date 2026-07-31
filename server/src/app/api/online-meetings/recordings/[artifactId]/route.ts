import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { isEnterprise } from '@alga-psa/core/features';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { hasPermission } from '@alga-psa/auth/rbac';
import { StorageService } from '@alga-psa/storage/StorageService';

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
    const row = await tenantDb(knex, tenant).table('teams_integrations')
      .first('expose_recordings_in_portal');
    return row?.expose_recordings_in_portal === true;
  } catch {
    return false;
  }
}

// A client-portal user may only reach a recording whose meeting belongs to their own
// contact/client. We resolve the owning client/contact from the meeting's interaction
// and compare against the authenticated client user — never trusting the artifact id
// alone to be correctly scoped by the listing layer.
async function clientUserOwnsMeeting(
  knex: any,
  tenant: string,
  user: any,
  interactionId: string | null,
): Promise<boolean> {
  const contactId = user?.contact_id;
  if (!interactionId || !contactId) {
    return false;
  }

  const db = tenantDb(knex, tenant);
  const interaction = await db.table('interactions')
    .where({ interaction_id: interactionId })
    .first('client_id', 'contact_name_id');
  if (!interaction) {
    return false;
  }

  if (interaction.contact_name_id && interaction.contact_name_id === contactId) {
    return true;
  }

  if (interaction.client_id) {
    const contact = await db.table('contacts')
      .where({ contact_name_id: contactId })
      .first('client_id');
    if (contact?.client_id && contact.client_id === interaction.client_id) {
      return true;
    }
  }

  return false;
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
  const isClientUser = (user as any).user_type === 'client';

  // Authorization. Enforcement keys off the server-known user type, never a
  // client-supplied parameter:
  //  - client-portal users require the tenant to have exposed recordings to the portal;
  //  - MSP (internal) users require interaction:read.
  if (isClientUser) {
    if (!(await portalVisibilityEnabled(knex, tenant))) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  } else if (!(await hasPermission(user as any, 'interaction', 'read', knex))) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const db = tenantDb(knex, tenant);
  const artifactQuery = db.table('online_meeting_artifacts as artifact')
    .where({
      'artifact.artifact_id': artifactId,
      'artifact.artifact_type': 'recording',
    });
  db.tenantJoin(artifactQuery, 'online_meetings as meeting', 'artifact.meeting_id', 'meeting.meeting_id');
  const artifact = await artifactQuery.first(
    'artifact.content_url',
    'artifact.provider_artifact_id',
    'artifact.file_id',
    'meeting.meeting_id',
    'meeting.interaction_id',
  );

  if (!artifact) {
    return new NextResponse('Recording not found', { status: 404 });
  }

  // Per-entity ownership: a client user may only access recordings for meetings tied
  // to their own contact/client. Return 404 (not 403) so a non-owning client can't
  // probe which artifact ids exist.
  if (isClientUser && !(await clientUserOwnsMeeting(knex, tenant, user, artifact.interaction_id))) {
    return new NextResponse('Recording not found', { status: 404 });
  }

  // Prefer the locally downloaded recording when the tenant opted into storage, so a
  // later Graph content outage doesn't break playback. Fall back to Graph on any error.
  if (artifact.file_id) {
    try {
      const stored = await StorageService.downloadFile(artifact.file_id);
      const storedHeaders = new Headers();
      storedHeaders.set('Content-Type', stored.metadata.mime_type || 'video/mp4');
      storedHeaders.set('Cache-Control', 'private, no-store');
      storedHeaders.set('Content-Length', String(stored.metadata.size));
      storedHeaders.set(
        'Content-Disposition',
        `attachment; filename="teams-recording-${artifact.provider_artifact_id}.mp4"`,
      );
      return new NextResponse(stored.buffer as any, { status: 200, headers: storedHeaders });
    } catch (error) {
      console.warn('[OnlineMeetingRecordingProxy] Stored recording unavailable, falling back to Graph', error);
    }
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
