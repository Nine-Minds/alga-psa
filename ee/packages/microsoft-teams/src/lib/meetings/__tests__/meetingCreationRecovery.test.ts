import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ config: { organizerUpn: 'organizer@example.invalid', organizerUserId: 'original-organizer', clientId: 'client', clientSecret: 'secret', microsoftTenantId: 'original-directory', sendMeetingInvites: true }, ready: true }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../meetingConfig', () => ({ resolveTeamsMeetingConfigState: vi.fn(async () => state.ready ? { status: 'ready', config: state.config } : { status: 'skipped', reason: 'not_configured' }), resolveTeamsMeetingGraphConfig: vi.fn(async () => state.ready ? state.config : null) }));
vi.mock('../../graphAuth', () => ({ fetchMicrosoftGraphAppToken: vi.fn(async () => 'test-token') }));
vi.mock('../../teams/microsoftEndpoints', () => ({ getMicrosoftGraphBaseUrl: () => 'https://graph.example.invalid/v1.0' }));
vi.mock('../artifactSubscriptions', () => ({ renewTeamsMeetingArtifactSubscriptions: vi.fn(async () => undefined) }));
import { createTeamsMeetingWithResult } from '../createTeamsMeeting';
import { getTeamsMeetingCreationTarget, recoverTeamsMeetingCreation, TEAMS_CREATION_OPERATION_PROPERTY } from '../meetingCreationRecovery';
const operationId = 'e185ae80-e29b-46ac-b88b-7dc2867b5436';
const target = { microsoftTenantId: 'original-directory', organizerUserId: 'original-organizer', organizerUpn: 'organizer@example.invalid', sendMeetingInvites: true };
const identity = { operationId, target };
const input = { tenantId: 'alga-tenant', subject: 'Appointment', startDateTime: '2026-09-21T09:30:00Z', endDateTime: '2026-09-21T11:00:00Z', creationIdentity: identity };
const fetchMock = vi.fn();
let events: any[], loseResponse: boolean, withJoinUrl: boolean, onlineIndexed: boolean, nextLink: boolean;
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  Object.assign(state.config, target); state.ready = true;
  events = []; loseResponse = false; withJoinUrl = true; onlineIndexed = true; nextLink = false;
  fetchMock.mockReset().mockImplementation(async (url: string, options: any) => {
    const parsed = new URL(url);
    if (options.method === 'GET' && parsed.pathname.endsWith('/events')) {
      expect(parsed.searchParams.get('$filter')).toContain(TEAMS_CREATION_OPERATION_PROPERTY);
      expect(parsed.searchParams.get('$filter')).toContain(operationId);
      return json({ value: events, ...(nextLink ? { '@odata.nextLink': 'https://untrusted.example.invalid/next' } : {}) });
    }
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      const event = { id: `event-${events.length + 1}`, transactionId: body.transactionId, onlineMeeting: withJoinUrl ? { joinUrl: 'https://teams.example.invalid/join' } : null };
      events.push(event);
      if (loseResponse) { loseResponse = false; throw new Error('Connection lost after the event committed'); }
      return json(event);
    }
    if (options.method === 'GET' && parsed.pathname.endsWith('/onlineMeetings')) return json({ value: onlineIndexed ? [{ id: 'online-meeting-1' }] : [] });
    throw new Error(`Unexpected mocked provider request: ${options.method} ${parsed.pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
it('returns nonsecret target metadata and tags one idempotent external event', async () => {
  expect(await getTeamsMeetingCreationTarget(input.tenantId)).toEqual({ status: 'ready', target });
  expect(await createTeamsMeetingWithResult(input)).toMatchObject({ status: 'created', meeting: { eventId: 'event-1', meetingId: 'online-meeting-1' } });
  expect(await createTeamsMeetingWithResult(input)).toMatchObject({ status: 'created', meeting: { eventId: 'event-1' } });
  const posts = fetchMock.mock.calls.filter(([, options]) => options.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0][1].body)).toMatchObject({ transactionId: operationId, singleValueExtendedProperties: [{ id: TEAMS_CREATION_OPERATION_PROPERTY, value: operationId }] });
  expect(posts[0][0]).toContain('/users/original-organizer/events');
  expect(posts[0][1].signal).toBeInstanceOf(AbortSignal);
});
it('recovers a lost response with GETs only and reuses the external event on retry', async () => {
  loseResponse = true;
  expect(await createTeamsMeetingWithResult(input)).toMatchObject({ status: 'failed' });
  const before = fetchMock.mock.calls.length;
  expect(await recoverTeamsMeetingCreation({ tenantId: input.tenantId, identity })).toMatchObject({ status: 'found', event: { eventId: 'event-1' }, meetingId: 'online-meeting-1' });
  expect(fetchMock.mock.calls.slice(before).every(([, options]) => options.method === 'GET')).toBe(true);
  expect(await createTeamsMeetingWithResult(input)).toMatchObject({ status: 'created', meeting: { eventId: 'event-1' } });
  expect(events).toHaveLength(1);
});
it('retains the event receipt when Graph omits the join URL', async () => {
  withJoinUrl = false;
  expect(await createTeamsMeetingWithResult(input)).toMatchObject({ status: 'failed', errorCode: 'graph_missing_meeting_fields', createdEvent: { eventId: 'event-1', microsoftTenantId: target.microsoftTenantId, organizerUserId: target.organizerUserId, joinWebUrl: null } });
  expect(await recoverTeamsMeetingCreation({ tenantId: input.tenantId, identity })).toMatchObject({ status: 'found', event: { eventId: 'event-1' }, meetingId: null });
});
it('retains cleanup evidence while online meeting indexing is delayed', async () => {
  onlineIndexed = false;
  expect(await createTeamsMeetingWithResult(input)).toMatchObject({ status: 'failed', createdEvent: { eventId: 'event-1', joinWebUrl: 'https://teams.example.invalid/join' } });
  expect(await recoverTeamsMeetingCreation({ tenantId: input.tenantId, identity })).toMatchObject({ status: 'found', event: { eventId: 'event-1' }, meetingId: null });
  onlineIndexed = true;
  expect(await createTeamsMeetingWithResult(input)).toMatchObject({ status: 'created', meeting: { eventId: 'event-1' } });
  expect(events).toHaveLength(1);
});
it('stops creation on organizer or invite-policy changes but can recover under the original organizer', async () => {
  expect(await createTeamsMeetingWithResult(input)).toMatchObject({ status: 'created' });
  state.config.organizerUserId = 'new-organizer'; state.config.sendMeetingInvites = false;
  const before = fetchMock.mock.calls.length;
  expect(await createTeamsMeetingWithResult(input)).toMatchObject({ status: 'failed', errorCode: 'creation_target_changed' });
  expect(fetchMock.mock.calls).toHaveLength(before);
  expect(await recoverTeamsMeetingCreation({ tenantId: input.tenantId, identity })).toMatchObject({ status: 'found', event: { organizerUserId: 'original-organizer' } });
  expect(fetchMock.mock.calls.slice(before).every(([url]) => String(url).includes('/users/original-organizer/'))).toBe(true);
});
it('does not switch directories or fabricate recovery when provider configuration is unavailable', async () => {
  state.config.microsoftTenantId = 'another-directory';
  expect(await recoverTeamsMeetingCreation({ tenantId: input.tenantId, identity })).toMatchObject({ status: 'failed', errorCode: 'creation_tenant_changed' });
  expect(fetchMock).not.toHaveBeenCalled();
  state.ready = false;
  expect(await recoverTeamsMeetingCreation({ tenantId: input.tenantId, identity })).toEqual({ status: 'skipped', reason: 'not_configured' });
  expect(await getTeamsMeetingCreationTarget(input.tenantId)).toEqual({ status: 'skipped', reason: 'not_configured' });
});
it.each(['duplicate', 'mismatch', 'next_link'])('rejects %s lookup results without POST or following external URLs', async mode => {
  events = [{ id: 'event-1', transactionId: operationId, onlineMeeting: { joinUrl: 'https://teams.example.invalid/join' } }];
  if (mode === 'duplicate') events.push({ ...events[0], id: 'event-2' });
  if (mode === 'mismatch') events[0].transactionId = 'another-operation';
  if (mode === 'next_link') nextLink = true;
  expect(await recoverTeamsMeetingCreation({ tenantId: input.tenantId, identity })).toMatchObject({ status: 'failed' });
  expect(await createTeamsMeetingWithResult(input)).toMatchObject({ status: 'failed' });
  expect(fetchMock.mock.calls.every(([url, options]) => String(url).startsWith('https://graph.example.invalid/') && options.method === 'GET')).toBe(true);
});
it('returns absent without creating an event and rejects malformed identity', async () => {
  expect(await recoverTeamsMeetingCreation({ tenantId: input.tenantId, identity })).toEqual({ status: 'absent' });
  fetchMock.mockClear();
  expect(await createTeamsMeetingWithResult({ ...input, creationIdentity: { ...identity, operationId: 'invalid' } })).toMatchObject({ status: 'failed' });
  expect(fetchMock).not.toHaveBeenCalled();
});
it('preserves ordinary creation without durable-operation fields for existing callers', async () => {
  expect(await createTeamsMeetingWithResult({ ...input, creationIdentity: undefined })).toMatchObject({ status: 'created' });
  const posts = fetchMock.mock.calls.filter(([, options]) => options.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0][1].body)).not.toHaveProperty('transactionId');
  expect(JSON.parse(posts[0][1].body)).not.toHaveProperty('singleValueExtendedProperties');
});
