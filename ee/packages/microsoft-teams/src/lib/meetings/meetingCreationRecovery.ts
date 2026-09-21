import { fetchMicrosoftGraphAppToken } from '../graphAuth';
import { getMicrosoftGraphBaseUrl } from '../teams/microsoftEndpoints';
import { resolveTeamsMeetingConfigState, resolveTeamsMeetingGraphConfig, type TeamsMeetingConfigSkipReason } from './meetingConfig';

export interface TeamsMeetingCreationTarget {
  microsoftTenantId: string;
  organizerUserId: string;
  organizerUpn: string;
  sendMeetingInvites: boolean;
}
export interface TeamsMeetingCreationIdentity { operationId: string; target: TeamsMeetingCreationTarget }
export interface CreatedTeamsEventReceipt {
  eventId: string;
  organizerUserId: string;
  organizerUpn: string;
  microsoftTenantId: string;
  joinWebUrl: string | null;
}
export type TeamsMeetingCreationTargetOutcome = { status: 'ready'; target: TeamsMeetingCreationTarget }
  | { status: 'skipped'; reason: TeamsMeetingConfigSkipReason };
export type RecoverTeamsMeetingCreationOutcome = { status: 'found'; event: CreatedTeamsEventReceipt; meetingId: string | null }
  | { status: 'absent' } | { status: 'skipped'; reason: TeamsMeetingConfigSkipReason }
  | { status: 'failed'; errorCode: string; errorMessage: string };

// A searchable property complements Graph transactionId: recovery must be
// read-only after a lost response, rather than retrying POST after revocation.
export const TEAMS_CREATION_OPERATION_PROPERTY = 'String {20f2bb9a-151a-4619-aa9d-0bb47a2d0dbf} Name AlgaAppointmentOperation';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertTeamsMeetingCreationIdentity(identity: TeamsMeetingCreationIdentity) {
  if (!identity || !uuid.test(identity.operationId) || !identity.target ||
    ![identity.target.microsoftTenantId, identity.target.organizerUserId, identity.target.organizerUpn].every(value => typeof value === 'string' && value.trim()) ||
    typeof identity.target.sendMeetingInvites !== 'boolean') throw new Error('Invalid Teams meeting creation identity');
}
export async function getTeamsMeetingCreationTarget(tenantId: string): Promise<TeamsMeetingCreationTargetOutcome> {
  const state = await resolveTeamsMeetingConfigState(tenantId);
  if (state.status !== 'ready') return state;
  const { microsoftTenantId, organizerUserId, organizerUpn, sendMeetingInvites } = state.config;
  return { status: 'ready', target: { microsoftTenantId, organizerUserId, organizerUpn, sendMeetingInvites } };
}

export interface CreationGraphEvent { id?: unknown; transactionId?: unknown; onlineMeeting?: { joinUrl?: unknown } | null }
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const escapeOData = (value: string) => value.replace(/'/g, "''");

export function teamsEventReceipt(event: CreationGraphEvent, target: TeamsMeetingCreationTarget): CreatedTeamsEventReceipt | undefined {
  const eventId = text(event.id);
  return eventId ? { eventId, organizerUserId: target.organizerUserId, organizerUpn: target.organizerUpn,
    microsoftTenantId: target.microsoftTenantId, joinWebUrl: text(event.onlineMeeting?.joinUrl) || null } : undefined;
}

export async function findTeamsCreationEvent(accessToken: string, identity: TeamsMeetingCreationIdentity): Promise<CreationGraphEvent | null> {
  assertTeamsMeetingCreationIdentity(identity);
  const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${escapeOData(TEAMS_CREATION_OPERATION_PROPERTY)}' and ep/value eq '${escapeOData(identity.operationId)}')`;
  const response = await fetch(`${getMicrosoftGraphBaseUrl()}/users/${encodeURIComponent(identity.target.organizerUserId)}/events?$filter=${encodeURIComponent(filter)}&$select=id,onlineMeeting,transactionId&$top=2`, {
    method: 'GET', signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Teams creation lookup failed (${response.status})`);
  const payload = await response.json() as { value?: CreationGraphEvent[]; '@odata.nextLink'?: unknown };
  if (!Array.isArray(payload.value) || payload.value.length > 1 || payload['@odata.nextLink']) throw new Error('Teams creation lookup is ambiguous');
  const event = payload.value[0];
  if (!event) return null;
  if (!text(event.id) || event.transactionId !== identity.operationId) throw new Error('Teams creation identity does not match');
  return event;
}

export async function resolveOnlineMeetingIdFromJoinUrl(params: { accessToken: string; organizerUpn: string; joinWebUrl: string }): Promise<string> {
  const filter = encodeURIComponent(`JoinWebUrl eq '${escapeOData(params.joinWebUrl)}'`);
  const response = await fetch(`${getMicrosoftGraphBaseUrl()}/users/${encodeURIComponent(params.organizerUpn)}/onlineMeetings?$filter=${filter}`, {
    method: 'GET', signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  if (!response.ok) throw new Error(`Failed to resolve online meeting (${response.status})`);
  const payload = await response.json() as { value?: Array<{ id?: unknown }> };
  const id = text(payload.value?.[0]?.id);
  if (!id) throw new Error('Microsoft Graph did not return an onlineMeeting id for the event join URL.');
  return id;
}

/** Looks up an existing operation under its original organizer. It never
 * creates an event, sends invitations or follows arbitrary provider URLs. */
export async function recoverTeamsMeetingCreation(input: { tenantId: string; identity: TeamsMeetingCreationIdentity }): Promise<RecoverTeamsMeetingCreationOutcome> {
  try {
    assertTeamsMeetingCreationIdentity(input.identity);
    const config = await resolveTeamsMeetingGraphConfig(input.tenantId);
    if (!config) return { status: 'skipped', reason: 'not_configured' };
    if (config.microsoftTenantId.toLowerCase() !== input.identity.target.microsoftTenantId.toLowerCase()) return { status: 'failed', errorCode: 'creation_tenant_changed', errorMessage: 'Restore the original Microsoft tenant configuration to recover this meeting.' };
    const accessToken = await fetchMicrosoftGraphAppToken({ tenantAuthority: config.microsoftTenantId, clientId: config.clientId, clientSecret: config.clientSecret });
    const event = await findTeamsCreationEvent(accessToken, input.identity);
    if (!event) return { status: 'absent' };
    const receipt = teamsEventReceipt(event, input.identity.target)!;
    let meetingId: string | null = null;
    if (receipt.joinWebUrl) {
      try { meetingId = await resolveOnlineMeetingIdFromJoinUrl({ accessToken, organizerUpn: receipt.organizerUserId, joinWebUrl: receipt.joinWebUrl }); }
      catch { /* The event receipt is sufficient for cancellation even while onlineMeeting indexing is delayed. */ }
    }
    return { status: 'found', event: receipt, meetingId };
  } catch { return { status: 'failed', errorCode: 'creation_lookup_failed', errorMessage: 'The external meeting creation could not be recovered yet.' }; }
}
