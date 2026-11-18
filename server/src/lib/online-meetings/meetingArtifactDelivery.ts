import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex, runWithTenant } from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';
import { isEnterprise } from '@alga-psa/core/features';
import { sharedWorkSeam } from '@alga-psa/shared/utils/sharedWorkSeam';
import type { SharedWorkActor } from '@alga-psa/scheduling/lib/sharedWorkScheduling';
import { isSharedWorkForbidden } from '@alga-psa/scheduling/lib/sharedWorkActor';

export interface MeetingArtifactContent {
  artifactId: string; type: 'recording' | 'transcript'; fileId: string | null; blocks: unknown;
  provider: { microsoftTenantId: string; organizerUserId: string; meetingId: string; artifactId: string } | null;
}

export interface SharedWorkMeetingArtifactProvider {
  consumeMeetingArtifact(db: any, tenant: string, artifactId: string, identify: () => Promise<SharedWorkActor>,
    consume: (content: MeetingArtifactContent) => Promise<{ value: NextResponse; discard?: () => Promise<void> }>
  ): Promise<{ handled: false } | { handled: true; value: NextResponse }>;
}

// LEVERAGE: pattern shared-work-seam — scheduling, clients, documents and the artifact route each declare one seam over the same generic registry.
export const meetingArtifactSeam = sharedWorkSeam<SharedWorkMeetingArtifactProvider>('meetingArtifacts');

function transcriptText(input: unknown): string {
  const blocks = typeof input === 'string' ? JSON.parse(input) : input;
  if (!Array.isArray(blocks)) throw new Error('Transcript content is unavailable');
  const text = (nodes: any[]): string => nodes.map(node => typeof node?.text === 'string' ? node.text : Array.isArray(node?.content) ? text(node.content) : '').join('');
  return blocks.map(block => text(Array.isArray(block?.content) ? block.content : [])).join('\n');
}

/**
 * Serves a retained meeting artifact through the 'meetingArtifacts' seam. Returns null when no
 * provider serves the tenant (the caller keeps its native behaviour). The provider endpoint is
 * derived from the retained original meeting and artifact; stored content URLs never receive a
 * bearer token and redirects are never followed.
 */
export async function serveMeetingArtifact(request: NextRequest, artifactId: string, tenant: string, identify: () => Promise<SharedWorkActor>): Promise<NextResponse | null> {
  try {
    return await runWithTenant(tenant, async () => {
      const { knex } = await createTenantKnex(tenant);
      const result = await meetingArtifactSeam.delegate(tenant, provider => provider.consumeMeetingArtifact(knex, tenant, artifactId, identify, async content => {
        const headers = new Headers({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': `attachment; filename="meeting-${artifactId}.${content.type === 'transcript' ? 'vtt' : 'mp4'}"`,
          'Content-Type': content.type === 'transcript' ? 'text/plain; charset=utf-8' : 'video/mp4' });
        if (content.blocks != null && content.type === 'transcript') return { value: new NextResponse(transcriptText(content.blocks), { headers }) };
        if (content.fileId) {
          const file = await StorageService.downloadFile(content.fileId);
          headers.set('Content-Length', String(file.buffer.length));
          return { value: new NextResponse(file.buffer as any, { headers }) };
        }
        if (!isEnterprise || !content.provider) return { value: new NextResponse('Artifact content is unavailable', { status: 404 }) };
        const ee: any = await import('@alga-psa/ee-microsoft-teams/lib');
        const config = await ee.resolveTeamsMeetingGraphConfig(tenant);
        const original = content.provider;
        if (!config || config.microsoftTenantId.toLowerCase() !== original.microsoftTenantId.toLowerCase()) return { value: new NextResponse('Artifact provider is unavailable', { status: 503 }) };
        const accessToken = await ee.fetchMicrosoftGraphAppToken({ tenantAuthority: config.microsoftTenantId, clientId: config.clientId, clientSecret: config.clientSecret });
        const url = `${ee.getMicrosoftGraphBaseUrl()}/users/${encodeURIComponent(original.organizerUserId)}/onlineMeetings/${encodeURIComponent(original.meetingId)}/${content.type === 'transcript' ? 'transcripts' : 'recordings'}/${encodeURIComponent(original.artifactId)}/content`;
        const providerHeaders: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
        const range = request.headers.get('range');
        if (content.type === 'recording' && range && /^bytes=\d+-\d*$/.test(range)) providerHeaders.Range = range;
        // Bound connection/header acquisition without aborting a valid long recording stream.
        const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 30_000);
        let response: Response;
        try { response = await fetch(url, { headers: providerHeaders, redirect: 'error', signal: abort.signal }); }
        finally { clearTimeout(timeout); }
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          return { value: new NextResponse('Artifact content is unavailable', { status: response.status === 404 ? 404 : 502 }) };
        }
        for (const key of ['content-length', 'content-range', 'accept-ranges']) { const value = response.headers.get(key); if (value) headers.set(key, value); }
        return { value: new NextResponse(response.body, { status: response.status, headers }), discard: () => response.body!.cancel() };
      }));
      return result.handled ? result.value : null;
    });
  } catch (error) {
    if (isSharedWorkForbidden(error)) return new NextResponse('Forbidden', { status: 403 });
    return new NextResponse('Artifact content is unavailable', { status: 503 });
  }
}
