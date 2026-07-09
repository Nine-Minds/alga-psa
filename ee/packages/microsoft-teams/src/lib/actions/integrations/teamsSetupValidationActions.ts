'use server';

import { hasPermission } from '@alga-psa/auth/rbac';
import { withAuth } from '@alga-psa/auth/withAuth';

import { resolveTeamsMicrosoftProviderConfigImpl } from '../../auth/teamsMicrosoftProviderResolution';
import { fetchMicrosoftGraphAppToken } from '../../graphAuth';
import { readBotCredentialsFromEnv } from '../../teams/bot/teamsBotConnector';
import { getTeamsAvailability } from '../../teams/teamsAvailability';

// Every Graph application permission the Teams integration actually exercises
// with app-only tokens:
// - Calendars.ReadWrite: /users/{upn}/events create/update/delete (create/update/deleteTeamsMeeting)
// - OnlineMeetings.ReadWrite.All: /users/{upn}/onlineMeetings create/read/delete
//   (verifyMeetingOrganizer, join-URL resolution in createTeamsMeeting)
// - OnlineMeetingRecording.Read.All: getAllRecordings subscription + recordings fetch
// - OnlineMeetingTranscript.Read.All: getAllTranscripts subscription + transcripts fetch
// - TeamsActivity.Send: /users/{id}/teamwork/sendActivityNotification
// - User.Read.All: /users/{upn} organizer lookups (teamsActions, verifyMeetingOrganizer)
const REQUIRED_GRAPH_APPLICATION_PERMISSIONS = [
  'Calendars.ReadWrite',
  'OnlineMeetings.ReadWrite.All',
  'OnlineMeetingRecording.Read.All',
  'OnlineMeetingTranscript.Read.All',
  'TeamsActivity.Send',
  'User.Read.All',
] as const;

const BOT_ENV_GUIDANCE = 'Configure TEAMS_BOT_APP_ID, TEAMS_BOT_APP_TENANT_ID, and TEAMS_BOT_APP_PASSWORD.';

export type TeamsGraphCredentialFailureReason =
  | 'addon_inactive'
  | 'profile_not_ready'
  | 'invalid_client_secret'
  | 'invalid_client_id'
  | 'invalid_microsoft_tenant_id'
  | 'network_error'
  | 'token_failure';

export type TeamsGraphCredentialValidationResult =
  | { status: 'ok' }
  | { status: 'failed'; reason: TeamsGraphCredentialFailureReason; message: string };

export interface TeamsGraphPermissionProbeEntry {
  permission: string;
  granted: boolean;
}

export type TeamsGraphPermissionsProbeResult =
  | { status: 'ok'; permissions: TeamsGraphPermissionProbeEntry[] }
  | {
      status: 'missing_permissions';
      permissions: TeamsGraphPermissionProbeEntry[];
      missingPermissions: string[];
      message: string;
    }
  | { status: 'failed'; reason: TeamsGraphCredentialFailureReason; message: string };

export type TeamsBotConnectorFailureReason =
  | 'addon_inactive'
  | 'not_configured'
  | 'invalid_password'
  | 'invalid_app_id'
  | 'invalid_tenant_id'
  | 'network_error'
  | 'token_failure';

export type TeamsBotConnectorValidationResult =
  | { status: 'ok'; appId: string }
  | { status: 'failed'; reason: TeamsBotConnectorFailureReason; message: string };

function isClientPortalUser(user: any): boolean {
  return user?.user_type === 'client';
}

// LEVERAGE: pattern teams-settings-permission-gate — same gate as teamsDiagnosticsActions/teamsActions/teamsPackageActions.
async function assertCanManageTeamsSettings(user: any): Promise<void> {
  if (isClientPortalUser(user) || !(await hasPermission(user as any, 'system_settings', 'update'))) {
    throw new Error('Forbidden');
  }
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

function extractAadstsCode(text: string): string | null {
  const match = /AADSTS\d+/i.exec(text);
  return match ? match[0].toUpperCase() : null;
}

type GraphTokenFailureReason = Exclude<TeamsGraphCredentialFailureReason, 'addon_inactive'>;

type GraphTokenAcquisition =
  | { status: 'ok'; accessToken: string }
  | { status: 'failed'; reason: GraphTokenFailureReason; message: string };

function classifyGraphTokenError(error: unknown): { reason: GraphTokenFailureReason; message: string } {
  const raw = toErrorMessage(error);
  const code = extractAadstsCode(raw);

  if (code === 'AADSTS7000215') {
    return {
      reason: 'invalid_client_secret',
      message: `Microsoft rejected the client secret for the selected Microsoft profile (${code}). Update the profile's client secret from the Azure app registration and save it again.`,
    };
  }
  if (code === 'AADSTS700016') {
    return {
      reason: 'invalid_client_id',
      message: `Microsoft did not recognize the application (client) id on the selected Microsoft profile (${code}). Verify it matches the Azure app registration.`,
    };
  }
  if (code === 'AADSTS90002') {
    return {
      reason: 'invalid_microsoft_tenant_id',
      message: `Microsoft did not recognize the Microsoft tenant id on the selected Microsoft profile (${code}). Verify the directory (tenant) id.`,
    };
  }

  const isTokenEndpointFailure =
    raw.startsWith('Failed to acquire Teams Graph token') ||
    raw.includes('did not include an access token');
  if (isTokenEndpointFailure) {
    return {
      reason: 'token_failure',
      message: code
        ? `Microsoft rejected the Graph token request (${code}): ${raw}`
        : `Microsoft rejected the Graph token request: ${raw}`,
    };
  }

  return {
    reason: 'network_error',
    message: `Could not reach login.microsoftonline.com to validate the Microsoft Graph credentials: ${raw}`,
  };
}

async function acquireTeamsGraphAppToken(tenant: string): Promise<GraphTokenAcquisition> {
  const resolution = await resolveTeamsMicrosoftProviderConfigImpl(tenant);
  if (
    resolution.status !== 'ready' ||
    !normalizeString(resolution.clientId) ||
    !normalizeString(resolution.clientSecret) ||
    !normalizeString(resolution.microsoftTenantId)
  ) {
    return {
      status: 'failed',
      reason: 'profile_not_ready',
      message: resolution.message || 'The selected Microsoft profile is not ready for Teams.',
    };
  }

  try {
    const accessToken = await fetchMicrosoftGraphAppToken({
      tenantAuthority: resolution.microsoftTenantId!,
      clientId: resolution.clientId!,
      clientSecret: resolution.clientSecret!,
    });
    return { status: 'ok', accessToken };
  } catch (error) {
    const { reason, message } = classifyGraphTokenError(error);
    return { status: 'failed', reason, message };
  }
}

function decodeGraphTokenRoles(accessToken: string): string[] | null {
  const segments = accessToken.split('.');
  if (segments.length < 2 || !segments[1]) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')) as {
      roles?: unknown;
    };
    if (!Array.isArray(payload.roles)) {
      return [];
    }
    return payload.roles.filter((role): role is string => typeof role === 'string');
  } catch {
    return null;
  }
}

// `message` is always present (empty when enabled) so callers need no
// discriminated-union narrowing — the EE server app typechecks this file with
// `strict: false`, where narrowing on the `enabled` boolean does not apply.
async function checkTeamsAddOn(
  user: unknown,
  tenant: string
): Promise<{ enabled: boolean; message: string }> {
  const availability = await getTeamsAvailability({
    tenantId: tenant,
    userId: normalizeString((user as any)?.user_id),
  });
  if (availability.enabled === false) {
    return { enabled: false, message: availability.message };
  }
  return { enabled: true, message: '' };
}

export async function validateTeamsGraphCredentialsImpl(
  user: unknown,
  { tenant }: { tenant: string },
  _input: Record<string, never> = {}
): Promise<TeamsGraphCredentialValidationResult> {
  await assertCanManageTeamsSettings(user as any);

  const addOn = await checkTeamsAddOn(user, tenant);
  if (!addOn.enabled) {
    return { status: 'failed', reason: 'addon_inactive', message: addOn.message };
  }

  const acquisition = await acquireTeamsGraphAppToken(tenant);
  if (acquisition.status === 'failed') {
    return { status: 'failed', reason: acquisition.reason, message: acquisition.message };
  }
  return { status: 'ok' };
}

export async function probeTeamsGraphPermissionsImpl(
  user: unknown,
  { tenant }: { tenant: string },
  _input: Record<string, never> = {}
): Promise<TeamsGraphPermissionsProbeResult> {
  await assertCanManageTeamsSettings(user as any);

  const addOn = await checkTeamsAddOn(user, tenant);
  if (!addOn.enabled) {
    return { status: 'failed', reason: 'addon_inactive', message: addOn.message };
  }

  const acquisition = await acquireTeamsGraphAppToken(tenant);
  if (acquisition.status === 'failed') {
    return { status: 'failed', reason: acquisition.reason, message: acquisition.message };
  }

  const roles = decodeGraphTokenRoles(acquisition.accessToken);
  if (roles === null) {
    return {
      status: 'failed',
      reason: 'token_failure',
      message: 'The Microsoft Graph token could not be decoded to read its granted application permissions.',
    };
  }

  const grantedRoles = new Set(roles);
  const permissions: TeamsGraphPermissionProbeEntry[] = REQUIRED_GRAPH_APPLICATION_PERMISSIONS.map(
    (permission) => ({
      permission,
      granted: grantedRoles.has(permission),
    })
  );
  const missingPermissions = permissions
    .filter((entry) => !entry.granted)
    .map((entry) => entry.permission);

  if (missingPermissions.length === 0) {
    return { status: 'ok', permissions };
  }

  return {
    status: 'missing_permissions',
    permissions,
    missingPermissions,
    message: `Grant admin consent for ${missingPermissions.join(', ')} in the Azure app registration.`,
  };
}

type BotTokenRequestResult =
  | { ok: true }
  | { ok: false; reason: Exclude<TeamsBotConnectorFailureReason, 'addon_inactive' | 'not_configured'>; message: string };

// Type predicate so the failure branch narrows under `strict: false` (see checkTeamsAddOn).
function isBotTokenFailure(
  result: BotTokenRequestResult,
): result is Extract<BotTokenRequestResult, { ok: false }> {
  return !result.ok;
}

async function requestBotFrameworkToken(credentials: {
  appId: string;
  tenantId: string;
  password: string;
}): Promise<BotTokenRequestResult> {
  let response: Response;
  try {
    response = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(credentials.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: credentials.appId,
          client_secret: credentials.password,
          scope: 'https://api.botframework.com/.default',
        }),
      }
    );
  } catch (error) {
    return {
      ok: false,
      reason: 'network_error',
      message: `Could not reach login.microsoftonline.com to validate the bot credentials: ${toErrorMessage(error)}`,
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const code = extractAadstsCode(body);
    if (code === 'AADSTS7000215') {
      return {
        ok: false,
        reason: 'invalid_password',
        message: `Microsoft rejected the bot client secret (${code}). Update TEAMS_BOT_APP_PASSWORD with a valid client secret from the bot app registration.`,
      };
    }
    if (code === 'AADSTS700016') {
      return {
        ok: false,
        reason: 'invalid_app_id',
        message: `Microsoft did not recognize the bot app id (${code}). Verify TEAMS_BOT_APP_ID matches the Azure Bot app registration.`,
      };
    }
    if (code === 'AADSTS90002') {
      return {
        ok: false,
        reason: 'invalid_tenant_id',
        message: `Microsoft did not recognize the bot tenant (${code}). Verify TEAMS_BOT_APP_TENANT_ID is the directory (tenant) id of the bot app registration.`,
      };
    }
    return {
      ok: false,
      reason: 'token_failure',
      message: code
        ? `Microsoft rejected the Bot Framework token request (${code}): ${body.slice(0, 300)}`
        : `Microsoft rejected the Bot Framework token request (${response.status}): ${body.slice(0, 300)}`,
    };
  }

  const payload = (await response.json().catch(() => ({}))) as { access_token?: unknown };
  if (!normalizeString(payload.access_token)) {
    return {
      ok: false,
      reason: 'token_failure',
      message: 'The Bot Framework token response did not include an access token.',
    };
  }
  return { ok: true };
}

export async function validateTeamsBotConnectorImpl(
  user: unknown,
  { tenant }: { tenant: string },
  _input: Record<string, never> = {}
): Promise<TeamsBotConnectorValidationResult> {
  await assertCanManageTeamsSettings(user as any);

  const addOn = await checkTeamsAddOn(user, tenant);
  if (!addOn.enabled) {
    return { status: 'failed', reason: 'addon_inactive', message: addOn.message };
  }

  const credentials = readBotCredentialsFromEnv();
  if (!credentials) {
    return { status: 'failed', reason: 'not_configured', message: BOT_ENV_GUIDANCE };
  }

  const tokenResult = await requestBotFrameworkToken(credentials);
  if (isBotTokenFailure(tokenResult)) {
    return { status: 'failed', reason: tokenResult.reason, message: tokenResult.message };
  }

  return { status: 'ok', appId: credentials.appId };
}

export const validateTeamsGraphCredentials = withAuth(validateTeamsGraphCredentialsImpl);
export const probeTeamsGraphPermissions = withAuth(probeTeamsGraphPermissionsImpl);
export const validateTeamsBotConnector = withAuth(validateTeamsBotConnectorImpl);
