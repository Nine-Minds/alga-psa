import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import msgraph from '../src/index';
const config = vi.hoisted(() => ({
  organizerUpn: 'organizer@contoso.example',
  organizerUserId: 'organizer-id',
  microsoftTenantId: 'meeting-tenant',
  clientId: 'meeting-client',
  clientSecret: 'synthetic-secret',
  sendMeetingInvites: true,
}));
// Only tenant configuration and background subscription scheduling are replaced.
// The application token client, endpoint guard and meeting HTTP adapters are real.
vi.mock('../../../../ee/packages/microsoft-teams/src/lib/meetings/meetingConfig', () => ({
  resolveTeamsMeetingConfigState: async () => ({ status: 'ready', config }),
}));
vi.mock('../../../../ee/packages/microsoft-teams/src/lib/meetings/artifactSubscriptions', () => ({
  renewTeamsMeetingArtifactSubscriptions: async () => undefined,
}));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }));
import { createTeamsMeetingWithResult } from '../../../../ee/packages/microsoft-teams/src/lib/meetings/createTeamsMeeting';
import { updateTeamsMeetingWithResult } from '../../../../ee/packages/microsoft-teams/src/lib/meetings/updateTeamsMeeting';
import { deleteTeamsMeetingWithResult } from '../../../../ee/packages/microsoft-teams/src/lib/meetings/deleteTeamsMeeting';
let host: EmulatorHost;
let base: string;
let control: string;
async function command(path: string, body: unknown) {
  const response = await fetch(`${control}/control/msgraph/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  expect((await response.json()).ok).toBe(true);
}
async function events() {
  const response = await fetch(`${control}/control/msgraph/state/calendar-events`);
  expect(response.ok).toBe(true);
  return (await response.json()).result as Array<Record<string, any>>;
}
const input = {
  tenantId: 'isolated-psa-tenant',
  subject: 'Appointment with client',
  startDateTime: '2026-09-09T10:00:00Z',
  endDateTime: '2026-09-09T10:30:00Z',
  attendees: [{ emailAddress: { address: 'client@contoso.example' }, type: 'required' as const }],
  bodyHtml: '<p>Appointment details</p>',
};
beforeAll(async () => {
  host = new EmulatorHost({ emulators: [msgraph], controlPort: 0, ports: { msgraph: 0 } });
  const started = await host.start();
  base = `http://127.0.0.1:${started.ports.msgraph}`;
  control = `http://127.0.0.1:${started.controlPort}`;
});
beforeEach(async () => {
  await command('reset', {});
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('TEAMS_EMULATOR_MODE', 'true');
  vi.stubEnv('MICROSOFT_GRAPH_BASE_URL', `${base}/v1.0`);
  vi.stubEnv('MICROSOFT_LOGIN_BASE_URL', base);
  await command('seed/client', { clientId: config.clientId, clientSecret: config.clientSecret });
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await host?.stop();
});
it('creates, reschedules and cancels the provider event through real Teams adapters', async () => {
  const created = await createTeamsMeetingWithResult(input);
  expect(created.status).toBe('created');
  if (created.status !== 'created') throw new Error(JSON.stringify(created));
  expect(created.meeting.joinWebUrl).toContain('meetup-join');
  expect(created.meeting.meetingId).toBeTruthy();
  const stored = await events();
  expect(stored).toHaveLength(1);
  const event = stored[0];
  expect(event.id).toBe(created.meeting.eventId);
  expect(event.subject).toBe(input.subject);
  expect(event.attendees).toEqual(input.attendees);
  expect(event.body).toEqual({ contentType: 'html', content: input.bodyHtml });
  const identity = { tenantId: input.tenantId, ...created.meeting };
  expect(
    await updateTeamsMeetingWithResult({
      ...identity,
      startDateTime: '2026-09-09T11:00:00Z',
      endDateTime: '2026-09-09T11:30:00Z',
      subject: 'Rescheduled appointment',
    }),
  ).toEqual({ status: 'updated' });
  const updated = (await events())[0];
  expect(updated.subject).toBe('Rescheduled appointment');
  expect(updated.start.dateTime).toBe('2026-09-09T11:00:00Z');
  expect(await deleteTeamsMeetingWithResult(identity)).toEqual({
    status: 'deleted',
    alreadyDeleted: false,
  });
  expect(await events()).toHaveLength(0);
  expect(await deleteTeamsMeetingWithResult(identity)).toEqual({
    status: 'deleted',
    alreadyDeleted: true,
  });
});
it('reports Graph throttling and recovers on the next creation', async () => {
  await command('faults/operation-fault/arm', {
    operation: `POST /users/${encodeURIComponent(config.organizerUpn)}/events`,
    status: 429,
    remaining: 1,
    body: { error: { code: 'TooManyRequests' } },
  });
  expect(await createTeamsMeetingWithResult(input)).toMatchObject({
    status: 'failed',
    errorCode: 'graph_throttled',
  });
  expect(await events()).toHaveLength(0);
  const recovered = await createTeamsMeetingWithResult(input);
  expect(recovered.status).toBe('created');
  if (recovered.status !== 'created') throw new Error(JSON.stringify(recovered));
  expect(await events()).toEqual([
    expect.objectContaining({ id: recovered.meeting.eventId, subject: input.subject }),
  ]);
});
