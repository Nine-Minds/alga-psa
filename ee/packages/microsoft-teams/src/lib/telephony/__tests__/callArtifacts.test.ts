import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const graphConfig = vi.hoisted(() => ({
  value: {
    microsoftTenantId: 'contoso.onmicrosoft.com',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  } as Record<string, string> | null,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../graphAuth', () => ({
  fetchMicrosoftGraphAppToken: vi.fn(async () => 'app-token'),
}));

vi.mock('../../meetings/meetingConfig', () => ({
  resolveTeamsMeetingGraphConfig: vi.fn(async () => graphConfig.value),
}));

import { downloadTeamsCallArtifactContent, fetchTeamsCallArtifacts } from '../callArtifacts';

const VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\n<v Caller>The printer is on fire again.';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchTeamsCallArtifacts', () => {
  const previousMode = process.env.TEAMS_EMULATOR_MODE;
  const previousBaseUrl = process.env.MICROSOFT_GRAPH_BASE_URL;

  beforeEach(() => {
    graphConfig.value = {
      microsoftTenantId: 'contoso.onmicrosoft.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    };
    process.env.TEAMS_EMULATOR_MODE = 'true';
    process.env.MICROSOFT_GRAPH_BASE_URL = 'http://localhost:4010/v1.0';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousMode === undefined) delete process.env.TEAMS_EMULATOR_MODE;
    else process.env.TEAMS_EMULATOR_MODE = previousMode;
    if (previousBaseUrl === undefined) delete process.env.MICROSOFT_GRAPH_BASE_URL;
    else process.env.MICROSOFT_GRAPH_BASE_URL = previousBaseUrl;
  });

  it('T073: reads recordings and transcripts from the ad hoc call, not the meeting surface', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/recordings')) {
        return jsonResponse({ value: [{ id: 'rec-1', createdDateTime: '2026-08-24T10:05:00Z' }] });
      }
      if (url.endsWith('/transcripts')) {
        return jsonResponse({ value: [{ id: 'tr-1', createdDateTime: '2026-08-24T10:06:00Z' }] });
      }
      return new Response(VTT, { status: 200, headers: { 'content-type': 'text/vtt' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const artifacts = await fetchTeamsCallArtifacts({
      tenantId: 'tenant-1',
      providerCallId: 'call-1',
      organizerUserId: 'agent-object-id',
    });

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toContain('http://localhost:4010/v1.0/users/agent-object-id/adhocCalls/call-1/recordings');
    expect(urls).toContain('http://localhost:4010/v1.0/users/agent-object-id/adhocCalls/call-1/transcripts');
    expect(urls.some((url) => url.includes('onlineMeetings'))).toBe(false);

    expect(artifacts).toEqual([
      {
        artifactType: 'recording',
        providerArtifactId: 'rec-1',
        contentUrl: 'http://localhost:4010/v1.0/users/agent-object-id/adhocCalls/call-1/recordings/rec-1/content',
        createdDateTime: '2026-08-24T10:05:00Z',
      },
      {
        artifactType: 'transcript',
        providerArtifactId: 'tr-1',
        contentUrl: 'http://localhost:4010/v1.0/users/agent-object-id/adhocCalls/call-1/transcripts/tr-1/content',
        createdDateTime: '2026-08-24T10:06:00Z',
        transcriptContent: VTT,
      },
    ]);
  });

  it('T073: treats 403/404 as "nothing recorded", because Teams Phone recording is off by default', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      (url.endsWith('/recordings')
        ? new Response('{}', { status: 403 })
        : new Response('{}', { status: 404 })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchTeamsCallArtifacts({
      tenantId: 'tenant-1',
      providerCallId: 'call-1',
      organizerUserId: 'agent-object-id',
    })).resolves.toEqual([]);
  });

  it('T073: a real Graph failure throws, so a transient error is never read as "no recording"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));

    await expect(fetchTeamsCallArtifacts({
      tenantId: 'tenant-1',
      providerCallId: 'call-1',
      organizerUserId: 'agent-object-id',
    })).rejects.toThrow(/500/);
  });

  it('T073: skips the fetch entirely when Teams is not configured for the tenant', async () => {
    graphConfig.value = null;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchTeamsCallArtifacts({
      tenantId: 'tenant-1',
      providerCallId: 'call-1',
      organizerUserId: 'agent-object-id',
    })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('T073: downloads recording bytes with the app token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('mp4-bytes', {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    })));

    const content = await downloadTeamsCallArtifactContent({
      tenantId: 'tenant-1',
      contentUrl: 'http://localhost:4010/v1.0/users/u/adhocCalls/call-1/recordings/rec-1/content',
    });

    expect(content?.contentType).toBe('video/mp4');
    expect(content?.buffer.toString()).toBe('mp4-bytes');
  });
});
