import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const resolveProviderConfigMock = vi.hoisted(() => vi.fn());
const fetchMicrosoftGraphAppTokenMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/auth/teamsMicrosoftProviderResolution', () => ({
  resolveTeamsMicrosoftProviderConfigImpl: resolveProviderConfigMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/graphAuth', () => ({
  fetchMicrosoftGraphAppToken: fetchMicrosoftGraphAppTokenMock,
}));

import {
  buildTeamsArtifactClientState,
  parseTeamsArtifactClientState,
  renewTeamsMeetingArtifactSubscriptions,
  resolveTeamsMeetingIdFromNotification,
} from '@alga-psa/ee-microsoft-teams/lib/meetings/artifactSubscriptions';

type IntegrationRow = Record<string, unknown>;

function buildKnex(row: IntegrationRow) {
  const updates: Array<Record<string, unknown>> = [];
  const first = vi.fn(async function first(this: { table?: string }) {
    if (this?.table === 'tenant_addons') {
      return { addon_key: 'teams' };
    }
    if (this?.table === 'teams_integrations') {
      return row;
    }
    return undefined;
  });
  const update = vi.fn(async (input: Record<string, unknown>) => {
    updates.push(input);
    Object.assign(row, input);
    return 1;
  });
  const where = vi.fn(function where(this: { table?: string }, _conditions: Record<string, unknown>) {
    const query = {
      table: this?.table,
      where,
      andWhere(callback: (builder: any) => void) {
        callback({ whereNull: () => ({ orWhere: () => undefined }) });
        return query;
      },
      first,
      update,
    };
    return query;
  });
  const knex: any = vi.fn((table: string) => ({ table, where }));
  knex.fn = { now: vi.fn(() => 'now()') };
  return { knex, updates };
}

describe('Teams meeting artifact subscriptions', () => {
  const originalFetch = global.fetch;
  const originalWebhookUrl = process.env.TEAMS_RECORDINGS_WEBHOOK_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEAMS_RECORDINGS_WEBHOOK_URL = 'https://example.test/api/teams/webhooks/recordings';
    resolveProviderConfigMock.mockResolvedValue({
      status: 'ready',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      microsoftTenantId: 'microsoft-tenant',
    });
    fetchMicrosoftGraphAppTokenMock.mockResolvedValue('graph-token');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalWebhookUrl === undefined) {
      delete process.env.TEAMS_RECORDINGS_WEBHOOK_URL;
    } else {
      process.env.TEAMS_RECORDINGS_WEBHOOK_URL = originalWebhookUrl;
    }
  });

  it('T078 creates recording and transcript subscriptions and persists id/expiry', async () => {
    const { knex, updates } = buildKnex({
      tenant: 'tenant-1',
      install_status: 'active',
      selected_profile_id: 'profile-1',
      default_meeting_organizer_upn: 'organizer@example.com',
      default_meeting_organizer_object_id: 'organizer-object-id',
      meeting_artifact_webhook_secret: 'known-secret',
      recordings_subscription_id: null,
      transcripts_subscription_id: null,
    });
    createTenantKnexMock.mockResolvedValue({ knex });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const isRecording = body.resource === 'communications/onlineMeetings/getAllRecordings';
      return new Response(JSON.stringify({
        id: isRecording ? 'recordings-subscription' : 'transcripts-subscription',
        expirationDateTime: isRecording ? '2026-06-03T00:00:00.000Z' : '2026-06-03T01:00:00.000Z',
      }), { status: 201 });
    });
    global.fetch = fetchMock as any;

    const result = await renewTeamsMeetingArtifactSubscriptions({ tenantId: 'tenant-1' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      resource: 'communications/onlineMeetings/getAllRecordings',
      notificationUrl: 'https://example.test/api/teams/webhooks/recordings',
      clientState: buildTeamsArtifactClientState('tenant-1', 'recordings', 'known-secret'),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toMatchObject({
      resource: 'communications/onlineMeetings/getAllTranscripts',
      clientState: buildTeamsArtifactClientState('tenant-1', 'transcripts', 'known-secret'),
    });
    expect(result.map((row) => row.kind)).toEqual(['recordings', 'transcripts']);
    expect(updates).toEqual([
      expect.objectContaining({ recordings_subscription_id: 'recordings-subscription' }),
      expect.objectContaining({ transcripts_subscription_id: 'transcripts-subscription' }),
    ]);
  });

  it('generates and persists a clientState secret when none is stored yet', async () => {
    const { knex, updates } = buildKnex({
      tenant: 'tenant-1',
      install_status: 'active',
      selected_profile_id: 'profile-1',
      default_meeting_organizer_upn: 'organizer@example.com',
      default_meeting_organizer_object_id: 'organizer-object-id',
      meeting_artifact_webhook_secret: null,
      recordings_subscription_id: null,
      transcripts_subscription_id: null,
    });
    createTenantKnexMock.mockResolvedValue({ knex });
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      id: 'sub', expirationDateTime: '2026-06-03T00:00:00.000Z',
    }), { status: 201 })) as any;

    await renewTeamsMeetingArtifactSubscriptions({ tenantId: 'tenant-1' });

    const secretUpdate = updates.find((u) => typeof u.meeting_artifact_webhook_secret === 'string');
    expect(secretUpdate).toBeDefined();
    expect(String(secretUpdate?.meeting_artifact_webhook_secret)).toHaveLength(64);
  });

  it('T079 renews near-expiry subscriptions and recreates one that returns 404', async () => {
    const { knex, updates } = buildKnex({
      tenant: 'tenant-1',
      install_status: 'active',
      selected_profile_id: 'profile-1',
      default_meeting_organizer_upn: 'organizer@example.com',
      default_meeting_organizer_object_id: 'organizer-object-id',
      recordings_subscription_id: 'rec-old',
      recordings_subscription_expires_at: new Date('2026-06-01T00:00:00.000Z'),
      transcripts_subscription_id: 'tr-old',
      transcripts_subscription_expires_at: new Date('2026-06-01T00:00:00.000Z'),
    });
    createTenantKnexMock.mockResolvedValue({ knex });
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === 'PATCH' && url.endsWith('/subscriptions/rec-old')) {
        return new Response(JSON.stringify({ id: 'rec-old', expirationDateTime: '2026-06-03T00:00:00.000Z' }), { status: 200 });
      }
      if (init.method === 'PATCH' && url.endsWith('/subscriptions/tr-old')) {
        return new Response('not found', { status: 404 });
      }
      return new Response(JSON.stringify({ id: 'tr-new', expirationDateTime: '2026-06-03T01:00:00.000Z' }), { status: 201 });
    });
    global.fetch = fetchMock as any;

    const result = await renewTeamsMeetingArtifactSubscriptions({ tenantId: 'tenant-1', lookAheadMinutes: 999999 });

    expect(result).toEqual([
      expect.objectContaining({ kind: 'recordings', subscriptionId: 'rec-old', action: 'renewed' }),
      expect.objectContaining({ kind: 'transcripts', subscriptionId: 'tr-new', action: 'created' }),
    ]);
    expect(fetchMock.mock.calls.map((call) => [call[1].method, call[0]])).toEqual([
      ['PATCH', 'https://graph.microsoft.com/v1.0/subscriptions/rec-old'],
      ['PATCH', 'https://graph.microsoft.com/v1.0/subscriptions/tr-old'],
      ['POST', 'https://graph.microsoft.com/v1.0/subscriptions'],
    ]);
    expect(updates.at(-1)).toMatchObject({ transcripts_subscription_id: 'tr-new' });
  });

  it('T081/T082 resolves the meeting from resourceData or decrypted resource data, while clientState only routes tenant/kind', async () => {
    expect(parseTeamsArtifactClientState('teams-online-meeting-artifacts:tenant-1:recordings:secret123')).toEqual({
      tenantId: 'tenant-1',
      kind: 'recordings',
      secret: 'secret123',
    });
    // A legacy clientState without a secret is no longer accepted.
    expect(parseTeamsArtifactClientState('teams-online-meeting-artifacts:tenant-1:recordings')).toBeNull();

    await expect(resolveTeamsMeetingIdFromNotification({
      clientState: 'teams-online-meeting-artifacts:tenant-1:recordings',
      resourceData: {
        '@odata.id': "communications/onlineMeetings('meeting-from-resource')/recordings('rec-1')",
      },
    })).resolves.toBe('meeting-from-resource');

    await expect(resolveTeamsMeetingIdFromNotification(
      {
        clientState: 'teams-online-meeting-artifacts:tenant-1:transcripts',
        encryptedContent: { data: 'encrypted' },
      },
      {
        decryptResourceData: async () => ({
          '@odata.id': "communications/onlineMeetings('meeting-from-decrypted')/transcripts('tr-1')",
        }),
      },
    )).resolves.toBe('meeting-from-decrypted');
  });
});
