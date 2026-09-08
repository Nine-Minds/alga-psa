import { Temporal } from '@js-temporal/polyfill';
import type { EmulatorCore, HostEnv } from '@alga-psa/emulator-host';

/** Vendor-shaped error the wire shell turns into an HTTP response. */
export class GraphApiError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(typeof body === 'string' ? body : JSON.stringify(body));
    this.name = 'GraphApiError';
  }
}

export interface GraphMessage {
  id: string;
  parentFolderId: string;
  internetMessageHeaders: Array<{ name: string; value: string }>;
  receivedDateTime: string;
  subject: string;
  bodyPreview: string;
  body: { contentType: string; content: string };
  from: { emailAddress: { address: string; name: string } };
  toRecipients: Array<{ emailAddress: { address: string } }>;
  attachments: unknown[];
}

export interface GraphSubscription {
  id: string;
  changeType: string;
  notificationUrl: string;
  resource: string;
  expirationDateTime: string;
  clientState?: string;
  /** Owning OAuth client; never serialized to the vendor surface. */
  clientId: string;
}

export interface GraphOrganization {
  id: string;
  displayName: string;
  verifiedDomains: Array<{
    name: string;
    isDefault: boolean;
    isInitial: boolean;
  }>;
}

export interface GraphDirectoryUser {
  id: string;
  displayName: string;
  givenName: string | null;
  surname: string | null;
  mail: string | null;
  userPrincipalName: string;
  accountEnabled: boolean;
  jobTitle: string | null;
  mobilePhone: string | null;
  businessPhones: string[];
  /** "Guest" marks a B2B/external identity, e.g. a client submitting via Teams. */
  userType: 'Member' | 'Guest';
  externalUserState: string | null;
}

export interface GraphTeamChannel {
  id: string;
  displayName: string;
  description: string | null;
  membershipType: 'standard' | 'private' | 'shared';
}

export interface GraphTeam {
  id: string;
  displayName: string;
  description: string | null;
  /** Stripped from the vendor surface; Graph serves channels on a sub-route. */
  channels: GraphTeamChannel[];
}

export interface GraphChatMember {
  id: string;
  displayName: string;
  userId: string | null;
}

export interface GraphChat {
  id: string;
  topic: string | null;
  chatType: 'oneOnOne' | 'group' | 'meeting';
  createdDateTime: string;
  members: GraphChatMember[];
}

export interface GraphChatMessage {
  id: string;
  chatId: string;
  createdDateTime: string;
  from: { user: { id: string; displayName: string } };
  body: { contentType: string; content: string };
}

export interface GraphOnlineMeeting {
  id: string;
  subject: string | null;
  joinWebUrl: string;
  startDateTime: string | null;
  endDateTime: string | null;
  /** Path segment the meeting was created under (organizer UPN or object id). */
  organizerUserId: string;
  createdDateTime: string;
}

export interface GraphCalendarEvent {
  id: string;
  subject: string | null;
  organizerUserId: string;
  start: unknown;
  end: unknown;
  isOnlineMeeting: boolean;
  onlineMeeting: { joinUrl: string } | null;
  /** The auto-created online meeting behind an isOnlineMeeting event. */
  onlineMeetingId: string | null;
  body: unknown;
  attendees: unknown[];
  createdDateTime: string;
  location?: unknown;
  showAs?: unknown;
  sensitivity?: unknown;
  isAllDay?: unknown;
  singleValueExtendedProperties?: unknown;
  lastModifiedDateTime?: string;
  recurrence?: unknown;
}

type CalendarDeltaItem = GraphCalendarEvent | { id: string; '@removed': { reason: 'deleted' } };
type CalendarDeltaSnapshot = {
  clientId: string;
  organizerUserId: string;
  start: number;
  end: number;
  fingerprints: Map<string, string>;
};
type CalendarDeltaPage = {
  clientId: string;
  items: CalendarDeltaItem[];
  offset: number;
  pageSize: number;
  deltaToken: string;
};

export type MeetingArtifactKind = 'recording' | 'transcript';

export interface GraphMeetingArtifact {
  id: string;
  meetingId: string;
  kind: MeetingArtifactKind;
  createdDateTime: string;
  /** VTT text for transcripts; stand-in payload for recordings. */
  content: string;
  contentType: string;
}

/** One Graph callRecords session endpoint (PSTN leg carries identity.phone). */
export interface GraphCallRecordEndpoint {
  identity: {
    phone?: { id: string } | null;
    user?: { id: string; displayName: string | null } | null;
  };
}

export interface GraphCallRecordSession {
  id: string;
  caller: GraphCallRecordEndpoint;
  callee: GraphCallRecordEndpoint;
  startDateTime: string;
  endDateTime: string;
  modalities: string[];
  failureInfo: { reason: string; stage: string } | null;
}

/**
 * A recording/transcript on an ad hoc call — the Teams Phone equivalent of a
 * meeting artifact, served from /users/{id}/adhocCalls/{callId}.
 */
export interface GraphCallArtifact {
  id: string;
  callId: string;
  kind: MeetingArtifactKind;
  createdDateTime: string;
  /** VTT text for transcripts; stand-in payload for recordings. */
  content: string;
  contentType: string;
}

/** A Teams Phone call detail record served by /communications/callRecords. */
export interface GraphCallRecord {
  id: string;
  version: number;
  type: string;
  modalities: string[];
  startDateTime: string;
  endDateTime: string;
  lastModifiedDateTime: string;
  organizer: { user: { id: string; displayName: string | null } } | null;
  participants: unknown[];
  sessions: GraphCallRecordSession[];
}

/** A conversation created through the Bot Framework connector (proactive send). */
export interface BotConversation {
  id: string;
  createdDateTime: string;
  isGroup: boolean;
  tenantId: string | null;
  members: unknown[];
}

/** One outbound activity the bot pushed at the connector. */
export interface CapturedBotActivity {
  id: string;
  method: 'POST' | 'PUT';
  conversationId: string;
  /** Activity id from the request path: the reply target (POST) or update target (PUT). */
  pathActivityId: string | null;
  replyToId: string | null;
  type: string | null;
  text: string | null;
  /** Card payloads verbatim, including Adaptive Card JSON. */
  attachments: unknown[];
  activity: Record<string, unknown>;
  receivedAt: string;
}

export interface ActivityNotificationRecord {
  id: string;
  userId: string;
  body: unknown;
  receivedAt: string;
}

/**
 * An outbound mail request captured by the Graph simulator. This records the
 * wire route as received, rather than claiming that an email was delivered.
 */
export interface CapturedSendMail {
  route: string;
  mailbox: string | null;
  encodedMailbox: string | null;
  payload: unknown;
  contentType: string | null;
  receivedAt: string;
}

/** Defaults for inbound activity injection; tune with the `configure` action. */
export interface BotConfig {
  /** Where injected activities are POSTed (the app's bot endpoint). */
  targetUrl: string;
  /** serviceUrl stamped on injected activities; the bot replies here. */
  serviceUrl: string;
  /** Audience of the signed inbound JWT; must equal TEAMS_BOT_APP_ID. */
  appId: string;
  tenantId: string;
}

export interface InboundBotActivityInput {
  type?: 'message' | 'invoke' | 'conversationUpdate';
  text?: string;
  fromId?: string;
  fromAadObjectId?: string;
  fromName?: string;
  conversationId?: string;
  conversationType?: 'personal' | 'groupChat' | 'channel';
  tenantId?: string;
  serviceUrl?: string;
  value?: Record<string, unknown>;
  targetUrl?: string;
  appId?: string;
  /**
   * Backdate the signed inbound token by this many seconds, to test the app
   * rejecting an expired one. Delivery-only: the activity itself is unaffected,
   * so buildInboundActivity ignores it.
   */
  tokenAgeSeconds?: number;
}

/**
 * Identity applied to bot-activity seeds that omit it. Repeating the same
 * fromAadObjectId/conversationId on every seed was the single most common piece
 * of boilerplate during the Teams work.
 */
export interface DefaultActor {
  fromAadObjectId?: string;
  fromId?: string;
  fromName?: string;
  conversationId?: string;
  conversationType?: 'personal' | 'groupChat' | 'channel';
  tenantId?: string;
}

/** A named seed payload the console can save and replay. */
export interface SeedPreset {
  name: string;
  seeder: string;
  payload: Record<string, unknown>;
  savedAt: string;
}

export interface OperationFault {
  status: number;
  body: unknown;
  remaining?: number;
}

export interface TokenGrantInput {
  grant_type?: string;
  client_id?: string;
  client_secret?: string;
  code?: string;
  redirect_uri?: string;
  refresh_token?: string;
  scope?: string;
}

export interface GraphApplication {
  id: string;
  appId: string;
  displayName: string;
  signInAudience?: string;
  web?: { redirectUris?: string[] };
  requiredResourceAccess?: unknown[];
}

export interface GraphServicePrincipal {
  id: string;
  appId: string;
}

export interface SeedMessageInput {
  id?: string;
  subject?: string;
  body?: string;
  from?: string;
  to?: string;
  receivedDateTime?: string;
  authenticationResults?: string;
}

export interface SeedOrganizationInput {
  id?: string;
  displayName?: string;
  primaryDomain?: string;
}

export interface SeedDirectoryUserInput {
  id?: string;
  displayName?: string;
  givenName?: string | null;
  surname?: string | null;
  mail?: string | null;
  userPrincipalName?: string;
  accountEnabled?: boolean;
  jobTitle?: string | null;
  mobilePhone?: string | null;
  businessPhones?: string[];
  userType?: 'Member' | 'Guest';
  externalUserState?: string | null;
}

export interface SeedTeamChannelInput {
  teamId?: string;
  teamDisplayName?: string;
  id?: string;
  displayName?: string;
  description?: string | null;
  membershipType?: 'standard' | 'private' | 'shared';
}

export interface SeedChatInput {
  id?: string;
  topic?: string | null;
  chatType?: 'oneOnOne' | 'group' | 'meeting';
  members?: Array<{ id?: string; displayName?: string; userId?: string | null }>;
  messages?: Array<{ id?: string; from?: string; fromName?: string; content?: string }>;
}

export const EMULATED_TENANT_ID = '11111111-2222-4333-8444-555555555555';

const DEFAULT_BOT_CONFIG: BotConfig = {
  targetUrl: 'http://localhost:3000/api/teams/bot/messages',
  serviceUrl: 'http://localhost:4010',
  appId: 'emulated-teams-bot-app-id',
  tenantId: EMULATED_TENANT_ID,
};

/**
 * Pure state machine for the emulated Microsoft login + Graph service.
 * All time flows through the host clock, so `algasim clock advance 2h`
 * expires access tokens and subscriptions exactly like real elapsed time.
 */
export class MsGraphCore implements EmulatorCore {
  private readonly clients = new Map<string, { secret: string; appRoles: string[] }>();
  private readonly codes = new Map<string, {
    clientId: string;
    redirectUri: string;
    nonce?: string;
    scope?: string;
  }>();
  private readonly refreshTokens = new Map<string, { clientId: string; revoked: boolean; scope: string }>();
  private readonly accessTokens = new Map<string, { clientId: string; expiresAt: number }>();
  readonly messages = new Map<string, GraphMessage>();
  readonly subscriptions = new Map<string, GraphSubscription>();
  readonly organizations = new Map<string, GraphOrganization>();
  readonly directoryUsers = new Map<string, GraphDirectoryUser>();
  readonly applications = new Map<string, GraphApplication>();
  readonly servicePrincipals = new Map<string, GraphServicePrincipal>();
  readonly teams = new Map<string, GraphTeam>();
  readonly chats = new Map<string, GraphChat>();
  readonly chatMessages = new Map<string, GraphChatMessage[]>();
  readonly calendarEvents = new Map<string, GraphCalendarEvent>();
  private readonly calendarDeltaSnapshots = new Map<string, CalendarDeltaSnapshot>();
  private readonly calendarDeltaPages = new Map<string, CalendarDeltaPage>();
  readonly onlineMeetings = new Map<string, GraphOnlineMeeting>();
  /** Keyed by meeting id; holds both recordings and transcripts. */
  readonly meetingArtifacts = new Map<string, GraphMeetingArtifact[]>();
  /** Teams Phone call detail records, keyed by call record id. */
  readonly callRecords = new Map<string, GraphCallRecord>();
  /** Keyed by call id; holds both call recordings and call transcripts. */
  readonly callArtifacts = new Map<string, GraphCallArtifact[]>();
  /** Notification delivery results per call record, for the state view. */
  readonly callRecordDeliveries = new Map<string, unknown[]>();
  readonly seedPresets = new Map<string, SeedPreset>();
  defaultActor: DefaultActor = {};
  readonly botConversations = new Map<string, BotConversation>();
  readonly capturedBotActivities: CapturedBotActivity[] = [];
  readonly activityNotifications: ActivityNotificationRecord[] = [];
  readonly capturedSendMail: CapturedSendMail[] = [];
  readonly faults = new Map<string, OperationFault>();
  accessTokenTtlSeconds = 3600;
  rotateRefreshTokens = true;
  botConfig: BotConfig = { ...DEFAULT_BOT_CONFIG };
  private idCounter = 0;

  constructor(readonly env: HostEnv) {}

  reset(): void {
    this.clients.clear();
    this.codes.clear();
    this.refreshTokens.clear();
    this.accessTokens.clear();
    this.messages.clear();
    this.subscriptions.clear();
    this.organizations.clear();
    this.directoryUsers.clear();
    this.applications.clear();
    this.servicePrincipals.clear();
    this.teams.clear();
    this.chats.clear();
    this.chatMessages.clear();
    this.calendarEvents.clear();
    this.calendarDeltaSnapshots.clear();
    this.calendarDeltaPages.clear();
    this.onlineMeetings.clear();
    this.meetingArtifacts.clear();
    this.callRecords.clear();
    this.callArtifacts.clear();
    this.callRecordDeliveries.clear();
    this.seedPresets.clear();
    this.defaultActor = {};
    this.botConversations.clear();
    this.capturedBotActivities.length = 0;
    this.activityNotifications.length = 0;
    this.capturedSendMail.length = 0;
    this.faults.clear();
    this.accessTokenTtlSeconds = 3600;
    this.rotateRefreshTokens = true;
    // Deliberately does not rotate the Bot Framework signing key: the app
    // caches the discovered JWKS, so a reset between tests must not invalidate
    // tokens it has already learned how to verify.
    this.botConfig = { ...DEFAULT_BOT_CONFIG };
  }

  private newId(prefix: string): string {
    this.idCounter += 1;
    const entropy = Math.floor(this.env.rng() * 0xffffffff).toString(16).padStart(8, '0');
    return `${prefix}-${this.idCounter.toString(36)}-${entropy}`;
  }

  private nowMs(): number {
    return this.env.clock.now().getTime();
  }

  // --- OAuth ---

  /**
   * `appRoles` are the admin-consented application permissions Entra stamps
   * into the `roles` claim of an app-only token. Empty (the default) emulates
   * an app registration whose permissions were never consented.
   */
  registerClient(clientId: string, clientSecret: string, appRoles: string[] = []): void {
    this.clients.set(clientId, { secret: clientSecret, appRoles: [...appRoles] });
  }

  authorize(clientId: string, redirectUri: string, input?: { nonce?: string; scope?: string }): string {
    if (!this.clients.has(clientId)) {
      throw new GraphApiError(400, { error: 'invalid_client' });
    }
    const code = this.newId('code');
    this.codes.set(code, { clientId, redirectUri, nonce: input?.nonce, scope: input?.scope });
    return code;
  }

  grantToken(input: TokenGrantInput): {
    access_token: string;
    /** Delegated grants require offline_access; app-only grants never include it. */
    refresh_token?: string;
    expires_in: number;
    token_type: 'Bearer';
    id_token?: string;
  } {
    if (this.clients.get(String(input.client_id))?.secret !== String(input.client_secret)) {
      throw new GraphApiError(401, { error: 'invalid_client' });
    }
    if (input.grant_type === 'authorization_code') {
      const code = this.codes.get(String(input.code));
      if (!code || code.clientId !== input.client_id || code.redirectUri !== input.redirect_uri) {
        throw new GraphApiError(400, { error: 'invalid_grant' });
      }
      this.codes.delete(String(input.code));
      return this.issueTokens(String(input.client_id), undefined, {
        nonce: code.nonce,
        scope: code.scope || input.scope,
      });
    }
    if (input.grant_type === 'refresh_token') {
      const refresh = this.refreshTokens.get(String(input.refresh_token));
      if (!refresh || refresh.revoked || refresh.clientId !== input.client_id) {
        throw new GraphApiError(400, { error: 'invalid_grant' });
      }
      return this.issueTokens(String(input.client_id), String(input.refresh_token), { scope: refresh.scope });
    }
    if (input.grant_type === 'client_credentials') {
      // App-only flow used by the Teams bot connector
      // (scope https://api.botframework.com/.default) and by Graph
      // app tokens. No user, so no refresh token is issued.
      return this.issueTokens(
        String(input.client_id),
        undefined,
        { scope: input.scope || 'https://graph.microsoft.com/.default', appOnly: true },
      );
    }
    throw new GraphApiError(400, { error: 'unsupported_grant_type' });
  }

  private encodeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.emulator`;
  }

  private issueTokens(
    clientId: string,
    existingRefreshToken?: string,
    claims?: { nonce?: string; scope?: string; appOnly?: boolean }
  ) {
    const tenantId = EMULATED_TENANT_ID;
    // OAuth requests accept resource-qualified Graph scopes; Graph access
    // tokens expose permission names in scp, which the application validates.
    const scope = (claims?.scope || 'Mail.Read Mail.Read.Shared offline_access')
      .split(/\s+/).filter(Boolean)
      .map(value => value.replace(/^https:\/\/graph\.microsoft\.com\//i, ''))
      .join(' ');
    // App-only tokens carry the consented application permissions in `roles`
    // and no `scp`; delegated tokens are the other way round. Setup probes
    // read `roles` straight off the token, exactly as Entra issues it.
    const accessToken = this.encodeJwt({
      // Expiry has second precision. Distinguish every grant so simultaneous
      // refreshes and clients cannot overwrite another token's stored identity.
      jti: this.newId('access'),
      tid: tenantId,
      iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      ...(claims?.appOnly
        ? { roles: this.clients.get(clientId)?.appRoles ?? [] }
        : { scp: scope }),
      aud: '00000003-0000-0000-c000-000000000000',
      exp: Math.floor((this.nowMs() + this.accessTokenTtlSeconds * 1000) / 1000),
    });
    const allowRefresh = !claims?.appOnly && scope.split(/\s+/).includes('offline_access');
    const refreshToken = allowRefresh
      ? (existingRefreshToken && !this.rotateRefreshTokens ? existingRefreshToken : this.newId('refresh'))
      : undefined;
    this.accessTokens.set(accessToken, {
      clientId,
      expiresAt: this.nowMs() + this.accessTokenTtlSeconds * 1000,
    });
    if (refreshToken) this.refreshTokens.set(refreshToken, { clientId, revoked: false, scope });
    if (existingRefreshToken && existingRefreshToken !== refreshToken) {
      this.refreshTokens.delete(existingRefreshToken);
    }
    return {
      access_token: accessToken,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
      expires_in: this.accessTokenTtlSeconds,
      token_type: 'Bearer' as const,
      ...(claims?.nonce
        ? { id_token: this.encodeJwt({ tid: tenantId, nonce: claims.nonce, aud: clientId }) }
        : {}),
    };
  }

  /** Returns the token record for a valid bearer token, else throws 401. */
  authenticate(bearerToken: string): { clientId: string } {
    const record = this.accessTokens.get(bearerToken);
    if (!record || record.expiresAt <= this.nowMs()) {
      throw new GraphApiError(401, {
        error: { code: 'InvalidAuthenticationToken', message: 'Access token is expired or invalid' },
      });
    }
    return record;
  }

  expireAccessTokens(): number {
    for (const token of this.accessTokens.values()) {
      token.expiresAt = 0;
    }
    return this.accessTokens.size;
  }

  revokeRefreshToken(refreshToken: string): boolean {
    const record = this.refreshTokens.get(refreshToken);
    if (record) {
      record.revoked = true;
    }
    return Boolean(record);
  }

  // --- Application registration ---

  createApplication(input: Omit<GraphApplication, 'id' | 'appId'>): GraphApplication {
    if (!input.displayName?.trim()) {
      throw new GraphApiError(400, { error: { code: 'Request_BadRequest', message: 'displayName is required' } });
    }
    const application: GraphApplication = {
      ...input,
      id: this.newId('application'),
      appId: this.newId('client'),
      displayName: input.displayName.trim(),
    };
    this.applications.set(application.id, application);
    return application;
  }

  deleteApplication(id: string): void {
    if (!this.applications.delete(id)) {
      throw new GraphApiError(404, { error: { code: 'Request_ResourceNotFound' } });
    }
  }

  createServicePrincipal(appId: string): GraphServicePrincipal {
    if (![...this.applications.values()].some((application) => application.appId === appId)) {
      throw new GraphApiError(400, { error: { code: 'Request_BadRequest', message: 'Unknown appId' } });
    }
    const servicePrincipal = { id: this.newId('service-principal'), appId };
    this.servicePrincipals.set(servicePrincipal.id, servicePrincipal);
    return servicePrincipal;
  }

  deleteServicePrincipal(id: string): void {
    if (!this.servicePrincipals.delete(id)) {
      throw new GraphApiError(404, { error: { code: 'Request_ResourceNotFound' } });
    }
  }

  addApplicationPassword(applicationId: string): { keyId: string; secretText: string } {
    if (!this.applications.has(applicationId)) {
      throw new GraphApiError(404, { error: { code: 'Request_ResourceNotFound' } });
    }
    return {
      keyId: this.newId('password'),
      secretText: this.newId('secret'),
    };
  }

  // --- Directory ---

  addOrganization(input: SeedOrganizationInput): GraphOrganization {
    const id = input.id ?? this.newId('organization');
    const primaryDomain = input.primaryDomain ?? 'example.test';
    const organization: GraphOrganization = {
      id,
      displayName: input.displayName ?? 'Emulated Entra Organization',
      verifiedDomains: [
        { name: primaryDomain, isDefault: true, isInitial: false },
        { name: `${id}.onmicrosoft.com`, isDefault: false, isInitial: true },
      ],
    };
    this.organizations.set(id, organization);
    return organization;
  }

  listOrganizations(): GraphOrganization[] {
    return [...this.organizations.values()];
  }

  addDirectoryUser(input: SeedDirectoryUserInput): GraphDirectoryUser {
    const id = input.id ?? this.newId('directory-user');
    const userPrincipalName = input.userPrincipalName ?? input.mail ?? `${id}@example.test`;
    const user: GraphDirectoryUser = {
      id,
      displayName: input.displayName ?? 'Emulated Entra User',
      givenName: input.givenName ?? null,
      surname: input.surname ?? null,
      mail: input.mail === undefined ? userPrincipalName : input.mail,
      userPrincipalName,
      accountEnabled: input.accountEnabled ?? true,
      jobTitle: input.jobTitle ?? null,
      mobilePhone: input.mobilePhone ?? null,
      businessPhones: input.businessPhones ?? [],
      userType: input.userType ?? 'Member',
      externalUserState: input.externalUserState ?? null,
    };
    this.directoryUsers.set(id, user);
    return user;
  }

  listDirectoryUsers(): GraphDirectoryUser[] {
    return [...this.directoryUsers.values()];
  }

  getDirectoryUser(id: string): GraphDirectoryUser {
    const user = this.directoryUsers.get(id);
    if (!user) {
      throw new GraphApiError(404, { error: { code: 'Request_ResourceNotFound' } });
    }
    return user;
  }

  // --- Faults ---

  injectOperationFault(operation: string, fault: OperationFault): void {
    this.faults.set(operation, fault);
  }

  clearOperationFaults(): void {
    this.faults.clear();
  }

  /**
   * Consume one occurrence of an operation-scoped fault, if armed.
   *
   * Exact match first, then trailing-wildcard patterns
   * ("POST /v3/conversations/x/activities/*"): reply paths embed a
   * server-generated activity id, so there is no literal to arm against.
   */
  consumeFault(operation: string): OperationFault | null {
    let key: string | undefined = this.faults.has(operation) ? operation : undefined;
    if (!key) {
      for (const candidate of this.faults.keys()) {
        if (candidate.endsWith('*') && operation.startsWith(candidate.slice(0, -1))) {
          key = candidate;
          break;
        }
      }
    }
    if (!key) return null;

    const fault = this.faults.get(key);
    if (!fault) return null;
    if (fault.remaining !== undefined) {
      fault.remaining -= 1;
      if (fault.remaining <= 0) this.faults.delete(key);
    }
    return fault;
  }

  // --- Mail ---

  getMailFolder(id: string): { id: string; displayName: string } {
    // Only Inbox is modeled. Its opaque ID is also accepted by the folder
    // routes; unknown folders must never silently read Inbox messages.
    if (id.toLowerCase() !== 'inbox' && id !== 'emulated-inbox-folder') {
      throw new GraphApiError(404, { error: { code: 'ErrorItemNotFound', message: 'Mailbox folder not found' } });
    }
    return { id: 'emulated-inbox-folder', displayName: 'Inbox' };
  }

  addMessage(input: SeedMessageInput): GraphMessage {
    const id = input.id ?? this.newId('message');
    const message: GraphMessage = {
      id,
      parentFolderId: this.getMailFolder('inbox').id,
      internetMessageHeaders: input.authenticationResults
        ? [{ name: 'Authentication-Results', value: input.authenticationResults }]
        : [],
      receivedDateTime: input.receivedDateTime ?? this.env.clock.now().toISOString(),
      subject: input.subject ?? 'Emulated support email',
      bodyPreview: input.body ?? 'Hello from the Graph emulator',
      body: { contentType: 'text', content: input.body ?? 'Hello from the Graph emulator' },
      from: { emailAddress: { address: input.from ?? 'sender@example.test', name: 'Emulated Sender' } },
      toRecipients: [{ emailAddress: { address: input.to ?? 'support@example.test' } }],
      attachments: [],
    };
    this.messages.set(id, message);
    return message;
  }

  listMessages(since: number, top: number): GraphMessage[] {
    return [...this.messages.values()]
      .filter((message) => new Date(message.receivedDateTime).getTime() >= since)
      .sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime))
      .slice(0, top);
  }

  getMessage(id: string): GraphMessage {
    const message = this.messages.get(id);
    if (!message) {
      throw new GraphApiError(404, { error: { code: 'ErrorItemNotFound' } });
    }
    return message;
  }

  messageMime(message: GraphMessage): string {
    return [
      `Message-ID: <${message.id}@graph-emulator>`,
      `Date: ${new Date(message.receivedDateTime).toUTCString()}`,
      `From: ${message.from.emailAddress.address}`,
      `To: ${message.toRecipients.map((r) => r.emailAddress.address).join(', ')}`,
      `Subject: ${message.subject}`,
      ...message.internetMessageHeaders.map(header => `${header.name}: ${header.value}`),
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      message.body.content,
    ].join('\r\n');
  }

  // --- Subscriptions ---

  createSubscription(clientId: string, input: Omit<GraphSubscription, 'id' | 'clientId'>): GraphSubscription {
    const subscription: GraphSubscription = { ...input, id: this.newId('subscription'), clientId };
    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  getSubscription(clientId: string, id: string): GraphSubscription {
    const subscription = this.subscriptions.get(id);
    if (!subscription || subscription.clientId !== clientId) {
      throw new GraphApiError(404, { error: { code: 'ResourceNotFound' } });
    }
    return subscription;
  }

  listSubscriptions(clientId: string): GraphSubscription[] {
    return [...this.subscriptions.values()].filter((subscription) => subscription.clientId === clientId);
  }

  deleteSubscription(clientId: string, id: string): void {
    this.getSubscription(clientId, id);
    this.subscriptions.delete(id);
  }

  /** Subscriptions whose expiration is still in the (virtual) future. */
  activeSubscriptions(): GraphSubscription[] {
    return [...this.subscriptions.values()].filter(
      (subscription) => new Date(subscription.expirationDateTime).getTime() > this.nowMs(),
    );
  }

  // --- Teams directory (teams, channels, chats) ---

  addTeamChannel(input: SeedTeamChannelInput): { team: GraphTeam; channel: GraphTeamChannel } {
    const teamId = input.teamId ?? this.newId('team');
    const team = this.teams.get(teamId) ?? {
      id: teamId,
      displayName: input.teamDisplayName ?? 'Emulated Team',
      description: null,
      channels: [],
    };
    if (input.teamDisplayName) team.displayName = input.teamDisplayName;
    this.teams.set(teamId, team);

    const channelId = input.id ?? this.newId('channel');
    const channel: GraphTeamChannel = {
      id: channelId,
      displayName: input.displayName ?? 'General',
      description: input.description ?? null,
      membershipType: input.membershipType ?? 'standard',
    };
    team.channels = [...team.channels.filter((existing) => existing.id !== channelId), channel];
    return { team, channel };
  }

  getTeam(id: string): GraphTeam {
    const team = this.teams.get(id);
    if (!team) {
      throw new GraphApiError(404, { error: { code: 'Request_ResourceNotFound' } });
    }
    return team;
  }

  addChat(input: SeedChatInput): GraphChat {
    const id = input.id ?? this.newId('chat');
    const chat: GraphChat = {
      id,
      topic: input.topic ?? null,
      chatType: input.chatType ?? 'oneOnOne',
      createdDateTime: this.env.clock.now().toISOString(),
      members: (input.members ?? []).map((member) => ({
        id: member.id ?? this.newId('chat-member'),
        displayName: member.displayName ?? 'Emulated Chat Member',
        userId: member.userId ?? null,
      })),
    };
    this.chats.set(id, chat);
    this.chatMessages.set(
      id,
      (input.messages ?? []).map((message) => ({
        id: message.id ?? this.newId('chat-message'),
        chatId: id,
        createdDateTime: this.env.clock.now().toISOString(),
        from: { user: { id: message.from ?? 'emulated-user', displayName: message.fromName ?? 'Emulated Sender' } },
        body: { contentType: 'html', content: message.content ?? '' },
      })),
    );
    return chat;
  }

  getChat(id: string): GraphChat {
    const chat = this.chats.get(id);
    if (!chat) {
      throw new GraphApiError(404, { error: { code: 'Request_ResourceNotFound' } });
    }
    return chat;
  }

  listChatMessages(id: string): GraphChatMessage[] {
    this.getChat(id);
    return this.chatMessages.get(id) ?? [];
  }

  // --- Meetings (calendar events, onlineMeetings, recordings/transcripts) ---

  createOnlineMeeting(
    organizerUserId: string,
    input: { subject?: string | null; startDateTime?: string | null; endDateTime?: string | null } = {},
  ): GraphOnlineMeeting {
    const id = this.newId('meeting');
    const meeting: GraphOnlineMeeting = {
      id,
      subject: input.subject ?? null,
      // Shaped like a real Teams join link; the app stores and displays it opaquely.
      joinWebUrl: `https://teams.microsoft.com/l/meetup-join/19%3ameeting_${id}/0`,
      startDateTime: input.startDateTime ?? null,
      endDateTime: input.endDateTime ?? null,
      organizerUserId,
      createdDateTime: this.env.clock.now().toISOString(),
    };
    this.onlineMeetings.set(id, meeting);
    return meeting;
  }

  getOnlineMeeting(meetingId: string): GraphOnlineMeeting {
    const meeting = this.onlineMeetings.get(meetingId);
    if (!meeting) {
      throw new GraphApiError(404, { error: { code: 'ResourceNotFound' } });
    }
    return meeting;
  }

  deleteOnlineMeeting(meetingId: string): void {
    this.getOnlineMeeting(meetingId);
    this.onlineMeetings.delete(meetingId);
    this.meetingArtifacts.delete(meetingId);
  }

  findOnlineMeetingsByJoinUrl(joinWebUrl: string): GraphOnlineMeeting[] {
    return [...this.onlineMeetings.values()].filter((meeting) => meeting.joinWebUrl === joinWebUrl);
  }

  createCalendarEvent(organizerUserId: string, body: Record<string, unknown>): GraphCalendarEvent {
    const isOnlineMeeting = body.isOnlineMeeting === true;
    const subject = typeof body.subject === 'string' ? body.subject : null;
    const start = (body.start as { dateTime?: string } | undefined) ?? null;
    const end = (body.end as { dateTime?: string } | undefined) ?? null;
    const meeting = isOnlineMeeting
      ? this.createOnlineMeeting(organizerUserId, {
          subject,
          startDateTime: start?.dateTime ?? null,
          endDateTime: end?.dateTime ?? null,
        })
      : null;
    const event: GraphCalendarEvent = {
      id: this.newId('event'),
      subject,
      organizerUserId,
      start,
      end,
      isOnlineMeeting,
      onlineMeeting: meeting ? { joinUrl: meeting.joinWebUrl } : null,
      onlineMeetingId: meeting?.id ?? null,
      body: body.body ?? null,
      attendees: Array.isArray(body.attendees) ? body.attendees : [],
      location: body.location,
      showAs: body.showAs,
      sensitivity: body.sensitivity,
      isAllDay: body.isAllDay,
      singleValueExtendedProperties: body.singleValueExtendedProperties,
      recurrence: body.recurrence,
      lastModifiedDateTime: this.env.clock.now().toISOString(),
      createdDateTime: this.env.clock.now().toISOString(),
    };
    this.calendarEvents.set(event.id, event);
    return event;
  }

  getCalendarEvent(eventId: string): GraphCalendarEvent {
    const event = this.calendarEvents.get(eventId);
    if (!event) {
      throw new GraphApiError(404, { error: { code: 'ErrorItemNotFound' } });
    }
    return event;
  }

  updateCalendarEvent(eventId: string, patch: Record<string, unknown>): GraphCalendarEvent {
    const event = this.getCalendarEvent(eventId);
    if (typeof patch.subject === 'string') event.subject = patch.subject;
    if (patch.start !== undefined) event.start = patch.start;
    if (patch.end !== undefined) event.end = patch.end;
    if (patch.body !== undefined) event.body = patch.body;
    if (Array.isArray(patch.attendees)) event.attendees = patch.attendees;
    for (const key of ['location', 'showAs', 'sensitivity', 'isAllDay', 'singleValueExtendedProperties', 'recurrence'] as const) {
      if (patch[key] !== undefined) event[key] = patch[key];
    }
    event.lastModifiedDateTime = this.env.clock.now().toISOString();
    return event;
  }

  deleteCalendarEvent(eventId: string): void {
    const event = this.getCalendarEvent(eventId);
    this.calendarEvents.delete(eventId);
    if (event.onlineMeetingId) {
      this.onlineMeetings.delete(event.onlineMeetingId);
      this.meetingArtifacts.delete(event.onlineMeetingId);
    }
  }

  /** Primary-calendar, single-instance UTC delta model. Tokens are per-run and
   * client-bound; pages freeze one sync round while later writes await the next.
   * Recurrence expansion and non-UTC zone conversion are explicitly unsupported.
   */
  calendarDelta(clientId: string, organizerUserId: string, input: {
    start?: string; end?: string; deltaToken?: string; skipToken?: string; pageSize?: number;
  }): { value: CalendarDeltaItem[]; deltaToken?: string; skipToken?: string } {
    const invalidToken = () => new GraphApiError(410, { error: { code: 'SyncStateNotFound', message: 'Restart calendar synchronization' } });
    const page = (state: CalendarDeltaPage) => {
      const value = structuredClone(state.items.slice(state.offset, state.offset + state.pageSize));
      const offset = state.offset + state.pageSize;
      if (offset < state.items.length) {
        const skipToken = this.newId('calendar-page');
        this.calendarDeltaPages.set(skipToken, { ...state, offset });
        return { value, skipToken };
      }
      return { value, deltaToken: state.deltaToken };
    };
    if (input.skipToken) {
      const state = this.calendarDeltaPages.get(input.skipToken);
      if (!state || state.clientId !== clientId) throw invalidToken();
      return page(state);
    }
    const previous = input.deltaToken ? this.calendarDeltaSnapshots.get(input.deltaToken) : undefined;
    if (input.deltaToken && (!previous || previous.clientId !== clientId || previous.organizerUserId !== organizerUserId)) throw invalidToken();
    const parseWindow = (value = '') => Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`);
    const start = previous?.start ?? parseWindow(input.start);
    const end = previous?.end ?? parseWindow(input.end);
    const pageSize = input.pageSize ?? 100;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
      throw new GraphApiError(400, { error: { code: 'InvalidArgument', message: 'Provide an ordered date window and page size from 1 to 1000' } });
    }
    const eventTime = (value: unknown) => {
      const date = value as { dateTime?: string; timeZone?: string } | null;
      let zone: Temporal.TimeZone;
      try { zone = Temporal.TimeZone.from(date?.timeZone || 'UTC') as Temporal.TimeZone; }
      catch {
        throw new GraphApiError(400, { error: { code: 'Request_UnsupportedQuery', message: 'Calendar delta requires a supported IANA timezone or UTC' } });
      }
      try {
        const text = date?.dateTime ?? '';
        // Explicit offsets identify an instant. Offset-free dateTime values are
        // wall clocks in the supplied zone, never in the host machine timezone.
        return /(?:Z|[+-]\d{2}:\d{2})$/i.test(text)
          ? Temporal.Instant.from(text).epochMilliseconds
          : Temporal.PlainDateTime.from(text).toZonedDateTime(zone, { disambiguation: 'reject' }).epochMilliseconds;
      } catch {
        throw new GraphApiError(400, { error: { code: 'InvalidArgument', message: 'Invalid or ambiguous calendar event date' } });
      }
    };
    const fingerprints = new Map<string, string>();
    const items: CalendarDeltaItem[] = [];
    for (const event of this.calendarEvents.values()) {
      if (event.organizerUserId !== organizerUserId) continue;
      if (event.recurrence) throw new GraphApiError(400, { error: { code: 'Request_UnsupportedQuery', message: 'Recurring calendar delta is not modeled' } });
      // calendarView includes events overlapping its window, not only those
      // entirely contained in it.
      const eventStart = eventTime(event.start);
      const eventEnd = eventTime(event.end);
      if (eventStart >= end || eventEnd <= start) continue;
      const fingerprint = JSON.stringify(event);
      fingerprints.set(event.id, fingerprint);
      if (previous?.fingerprints.get(event.id) !== fingerprint) items.push({
        ...structuredClone(event),
        // Graph calendarView/delta defaults response dates to UTC. Keep stored
        // vendor state intact so token comparisons track actual source edits.
        start: { dateTime: new Date(eventStart).toISOString(), timeZone: 'UTC' },
        end: { dateTime: new Date(eventEnd).toISOString(), timeZone: 'UTC' },
      });
    }
    for (const id of previous?.fingerprints.keys() ?? []) {
      if (!fingerprints.has(id)) items.push({ id, '@removed': { reason: 'deleted' } });
    }
    const deltaToken = this.newId('calendar-delta');
    this.calendarDeltaSnapshots.set(deltaToken, { clientId, organizerUserId, start, end, fingerprints });
    return page({ clientId, items, offset: 0, pageSize, deltaToken });
  }

  addMeetingArtifact(
    kind: MeetingArtifactKind,
    meetingId: string,
    input: { id?: string; content?: string; createdDateTime?: string } = {},
  ): GraphMeetingArtifact {
    this.getOnlineMeeting(meetingId);
    const artifact: GraphMeetingArtifact = {
      id: input.id ?? this.newId(kind),
      meetingId,
      kind,
      createdDateTime: input.createdDateTime ?? this.env.clock.now().toISOString(),
      content:
        input.content ??
        (kind === 'transcript'
          ? 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\n<v Emulated Speaker>Hello from the algasim transcript.'
          : `algasim-recording-bytes:${meetingId}`),
      contentType: kind === 'transcript' ? 'text/vtt' : 'video/mp4',
    };
    const list = this.meetingArtifacts.get(meetingId) ?? [];
    list.push(artifact);
    this.meetingArtifacts.set(meetingId, list);
    return artifact;
  }

  listMeetingArtifacts(kind: MeetingArtifactKind, meetingId: string): GraphMeetingArtifact[] {
    this.getOnlineMeeting(meetingId);
    return (this.meetingArtifacts.get(meetingId) ?? []).filter((artifact) => artifact.kind === kind);
  }

  getMeetingArtifact(kind: MeetingArtifactKind, meetingId: string, artifactId: string): GraphMeetingArtifact {
    const artifact = this.listMeetingArtifacts(kind, meetingId).find((candidate) => candidate.id === artifactId);
    if (!artifact) {
      throw new GraphApiError(404, { error: { code: 'ResourceNotFound' } });
    }
    return artifact;
  }

  // --- Teams Phone call records ---

  /**
   * Build a callRecord the shape real Graph returns: the PSTN leg lives on a
   * session endpoint's `identity.phone.id`, which is what the adapter reads to
   * decide direction and extract the counterparty number. An unanswered call
   * carries `failureInfo` and a zero-length session, exactly as Graph reports
   * a missed call.
   */
  addCallRecord(input: {
    id?: string;
    direction?: 'inbound' | 'outbound';
    callerNumber?: string;
    calleeNumber?: string;
    organizerUserId?: string;
    startedAt?: string;
    durationSeconds?: number;
    answered?: boolean;
    modality?: 'audio' | 'video';
  } = {}): GraphCallRecord {
    const id = input.id ?? this.newId('callRecord');
    const direction = input.direction ?? 'inbound';
    const answered = input.answered ?? true;
    const durationSeconds = answered ? input.durationSeconds ?? 120 : 0;
    const start = input.startedAt ?? this.env.clock.now().toISOString();
    const end = new Date(new Date(start).getTime() + durationSeconds * 1000).toISOString();
    const organizerUserId = input.organizerUserId ?? 'emulated-organizer';
    const modality = input.modality ?? 'audio';

    const phoneEndpoint = (number: string): GraphCallRecordEndpoint => ({ identity: { phone: { id: number } } });
    const userEndpoint = (): GraphCallRecordEndpoint => ({
      identity: { user: { id: organizerUserId, displayName: 'Emulated Agent' } },
    });

    const callerNumber = input.callerNumber ?? '+15551234567';
    const calleeNumber = input.calleeNumber ?? '+15559990000';

    const session: GraphCallRecordSession = {
      id: `${id}-session-1`,
      caller: direction === 'inbound' ? phoneEndpoint(callerNumber) : userEndpoint(),
      callee: direction === 'inbound' ? userEndpoint() : phoneEndpoint(calleeNumber),
      startDateTime: start,
      endDateTime: end,
      modalities: [modality],
      failureInfo: answered ? null : { reason: 'The call was not answered.', stage: 'callSetup' },
    };

    const record: GraphCallRecord = {
      id,
      version: 1,
      type: 'peerToPeer',
      modalities: [modality],
      startDateTime: start,
      endDateTime: end,
      lastModifiedDateTime: this.env.clock.now().toISOString(),
      organizer: { user: { id: organizerUserId, displayName: 'Emulated Agent' } },
      participants: [],
      sessions: [session],
    };

    this.callRecords.set(id, record);
    return record;
  }

  getCallRecord(callRecordId: string): GraphCallRecord {
    const record = this.callRecords.get(callRecordId);
    if (!record) {
      throw new GraphApiError(404, { error: { code: 'ResourceNotFound' } });
    }
    return record;
  }

  /**
   * Attach a recording/transcript to a call. Real Graph publishes these on the
   * ad hoc call minutes after it ends and never notifies about them, so there
   * are no deliveries here: the app has to poll, and this is what it finds.
   */
  addCallArtifact(
    kind: MeetingArtifactKind,
    callId: string,
    input: { id?: string; content?: string; createdDateTime?: string } = {},
  ): GraphCallArtifact {
    this.getCallRecord(callId);
    const artifact: GraphCallArtifact = {
      id: input.id ?? this.newId(`call-${kind}`),
      callId,
      kind,
      createdDateTime: input.createdDateTime ?? this.env.clock.now().toISOString(),
      content:
        input.content ??
        (kind === 'transcript'
          ? 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\n<v Emulated Caller>Hello from the algasim call transcript.'
          : `algasim-call-recording-bytes:${callId}`),
      contentType: kind === 'transcript' ? 'text/vtt' : 'video/mp4',
    };
    const list = this.callArtifacts.get(callId) ?? [];
    list.push(artifact);
    this.callArtifacts.set(callId, list);
    return artifact;
  }

  listCallArtifacts(kind: MeetingArtifactKind, callId: string): GraphCallArtifact[] {
    this.getCallRecord(callId);
    return (this.callArtifacts.get(callId) ?? []).filter((artifact) => artifact.kind === kind);
  }

  getCallArtifact(kind: MeetingArtifactKind, callId: string, artifactId: string): GraphCallArtifact {
    const artifact = this.listCallArtifacts(kind, callId).find((candidate) => candidate.id === artifactId);
    if (!artifact) {
      throw new GraphApiError(404, { error: { code: 'ResourceNotFound' } });
    }
    return artifact;
  }

  /**
   * The documented enumeration surface: getAllRecordings/getAllTranscripts —
   * every artifact of the given kind across the organizer's calls, optionally
   * windowed by createdDateTime. Real Graph exposes NO per-call artifact list.
   */
  listAdhocArtifactsForOrganizer(
    kind: MeetingArtifactKind,
    organizerUserId: string,
    window: { startDateTime?: string; endDateTime?: string } = {},
  ): GraphCallArtifact[] {
    const start = window.startDateTime ? new Date(window.startDateTime).getTime() : null;
    const end = window.endDateTime ? new Date(window.endDateTime).getTime() : null;
    const results: GraphCallArtifact[] = [];
    for (const record of this.callRecords.values()) {
      if (record.organizer?.user?.id !== organizerUserId) continue;
      for (const artifact of this.callArtifacts.get(record.id) ?? []) {
        if (artifact.kind !== kind) continue;
        const created = new Date(artifact.createdDateTime).getTime();
        if (start !== null && !Number.isNaN(created) && created < start) continue;
        if (end !== null && !Number.isNaN(created) && created > end) continue;
        results.push(artifact);
      }
    }
    return results;
  }

  // --- Bot Framework connector ---

  createConversation(input: { isGroup?: boolean; tenantId?: string; members?: unknown[] }): BotConversation {
    const conversation: BotConversation = {
      id: this.newId('conversation'),
      createdDateTime: this.env.clock.now().toISOString(),
      isGroup: input.isGroup ?? false,
      tenantId: input.tenantId ?? this.botConfig.tenantId,
      members: input.members ?? [],
    };
    this.botConversations.set(conversation.id, conversation);
    return conversation;
  }

  /** Capture an activity the bot pushed at the connector; returns its new id. */
  recordBotActivity(input: {
    method: 'POST' | 'PUT';
    conversationId: string;
    pathActivityId?: string | null;
    activity: Record<string, unknown>;
  }): CapturedBotActivity {
    const activity = input.activity ?? {};
    const captured: CapturedBotActivity = {
      id: input.method === 'PUT' && input.pathActivityId ? input.pathActivityId : this.newId('activity'),
      method: input.method,
      conversationId: input.conversationId,
      pathActivityId: input.pathActivityId ?? null,
      replyToId: typeof activity.replyToId === 'string' ? activity.replyToId : input.pathActivityId ?? null,
      type: typeof activity.type === 'string' ? activity.type : null,
      text: typeof activity.text === 'string' ? activity.text : null,
      attachments: Array.isArray(activity.attachments) ? activity.attachments : [],
      activity,
      receivedAt: this.env.clock.now().toISOString(),
    };
    this.capturedBotActivities.push(captured);
    return captured;
  }

  clearBotActivities(): number {
    const cleared = this.capturedBotActivities.length;
    this.capturedBotActivities.length = 0;
    return cleared;
  }

  recordActivityNotification(userId: string, body: unknown): ActivityNotificationRecord {
    const record: ActivityNotificationRecord = {
      id: this.newId('activity-notification'),
      userId,
      body,
      receivedAt: this.env.clock.now().toISOString(),
    };
    this.activityNotifications.push(record);
    return record;
  }

  recordSendMail(input: Omit<CapturedSendMail, 'receivedAt'>): CapturedSendMail {
    const record: CapturedSendMail = { ...input, receivedAt: this.env.clock.now().toISOString() };
    this.capturedSendMail.push(record);
    return record;
  }

  /**
   * Assemble the Bot Framework Activity that inbound injection delivers to the
   * app's bot endpoint. Pure: the notifier signs it and performs the POST.
   */
  /**
   * `--state-file` support. Only durable seeded state is serialized: OAuth
   * codes, access tokens and armed faults are per-run and deliberately dropped,
   * and the Bot Framework signing key is NOT part of the snapshot (the app
   * caches the discovered JWKS, so restoring must not rotate it).
   *
   * Registered clients ARE durable: they are configuration, not a session, and
   * without them a restarted emulator answers every app-only token request with
   * invalid_client while its seeds sit there looking healthy.
   */
  snapshot(): unknown {
    return {
      clients: [...this.clients.entries()].map(([clientId, client]) => ({ clientId, ...client })),
      messages: [...this.messages.values()],
      subscriptions: [...this.subscriptions.values()],
      organizations: [...this.organizations.values()],
      directoryUsers: [...this.directoryUsers.values()],
      applications: [...this.applications.values()],
      servicePrincipals: [...this.servicePrincipals.values()],
      teams: [...this.teams.values()],
      chats: [...this.chats.values()],
      chatMessages: [...this.chatMessages.entries()],
      calendarEvents: [...this.calendarEvents.values()],
      onlineMeetings: [...this.onlineMeetings.values()],
      meetingArtifacts: [...this.meetingArtifacts.entries()],
      callRecords: [...this.callRecords.values()],
      callArtifacts: [...this.callArtifacts.entries()],
      seedPresets: [...this.seedPresets.values()],
      defaultActor: this.defaultActor,
      accessTokenTtlSeconds: this.accessTokenTtlSeconds,
      rotateRefreshTokens: this.rotateRefreshTokens,
      botConfig: this.botConfig,
      idCounter: this.idCounter,
    };
  }

  restore(state: unknown): void {
    this.calendarDeltaSnapshots.clear();
    this.calendarDeltaPages.clear();
    const snapshot = (state ?? {}) as Record<string, any>;
    const load = <V>(target: Map<string, V>, rows: unknown, key: (row: any) => string) => {
      target.clear();
      for (const row of Array.isArray(rows) ? rows : []) {
        target.set(key(row), row as V);
      }
    };
    const loadEntries = <V>(target: Map<string, V>, entries: unknown) => {
      target.clear();
      for (const entry of Array.isArray(entries) ? entries : []) {
        if (Array.isArray(entry) && typeof entry[0] === 'string') {
          target.set(entry[0], entry[1] as V);
        }
      }
    };

    this.clients.clear();
    for (const row of Array.isArray(snapshot.clients) ? snapshot.clients : []) {
      this.registerClient(String(row.clientId), String(row.secret), Array.isArray(row.appRoles) ? row.appRoles : []);
    }
    load(this.messages, snapshot.messages, (row) => row.id);
    load(this.subscriptions, snapshot.subscriptions, (row) => row.id);
    load(this.organizations, snapshot.organizations, (row) => row.id);
    load(this.directoryUsers, snapshot.directoryUsers, (row) => row.id);
    load(this.applications, snapshot.applications, (row) => row.id);
    load(this.servicePrincipals, snapshot.servicePrincipals, (row) => row.id);
    load(this.teams, snapshot.teams, (row) => row.id);
    load(this.chats, snapshot.chats, (row) => row.id);
    loadEntries(this.chatMessages, snapshot.chatMessages);
    load(this.calendarEvents, snapshot.calendarEvents, (row) => row.id);
    load(this.onlineMeetings, snapshot.onlineMeetings, (row) => row.id);
    loadEntries(this.meetingArtifacts, snapshot.meetingArtifacts);
    load(this.callRecords, snapshot.callRecords, (row) => row.id);
    loadEntries(this.callArtifacts, snapshot.callArtifacts);
    load(this.seedPresets, snapshot.seedPresets, (row) => row.name);

    this.defaultActor = snapshot.defaultActor ?? {};
    if (typeof snapshot.accessTokenTtlSeconds === 'number') this.accessTokenTtlSeconds = snapshot.accessTokenTtlSeconds;
    if (typeof snapshot.rotateRefreshTokens === 'boolean') this.rotateRefreshTokens = snapshot.rotateRefreshTokens;
    if (snapshot.botConfig) this.botConfig = { ...this.botConfig, ...snapshot.botConfig };
    // Keep minting ids past the restored high-water mark so a restored run
    // cannot collide with what the previous run already handed to the app.
    if (typeof snapshot.idCounter === 'number') this.idCounter = snapshot.idCounter;
  }

  recordCallDeliveries(callRecordId: string, deliveries: unknown[]): void {
    this.callRecordDeliveries.set(callRecordId, deliveries);
  }

  saveSeedPreset(name: string, seeder: string, payload: Record<string, unknown>): SeedPreset {
    const preset: SeedPreset = { name, seeder, payload, savedAt: this.env.clock.now().toISOString() };
    this.seedPresets.set(name, preset);
    return preset;
  }

  deleteSeedPreset(name: string): boolean {
    return this.seedPresets.delete(name);
  }

  listSeedPresets(): SeedPreset[] {
    return [...this.seedPresets.values()];
  }

  buildInboundActivity(input: InboundBotActivityInput): {
    activity: Record<string, unknown>;
    targetUrl: string;
    serviceUrl: string;
    audience: string;
    aadObjectId: string;
    tenantId: string;
  } {
    const serviceUrl = input.serviceUrl ?? this.botConfig.serviceUrl;
    // Explicit values always win over the configured default actor.
    const tenantId = input.tenantId ?? this.defaultActor.tenantId ?? this.botConfig.tenantId;
    const audience = input.appId ?? this.botConfig.appId;
    const aadObjectId = input.fromAadObjectId ?? this.defaultActor.fromAadObjectId ?? this.newId('aad-object');
    const conversationType = input.conversationType ?? this.defaultActor.conversationType ?? 'personal';
    const activity: Record<string, unknown> = {
      type: input.type ?? 'message',
      id: this.newId('inbound-activity'),
      timestamp: this.env.clock.now().toISOString(),
      channelId: 'msteams',
      serviceUrl,
      from: {
        id: input.fromId ?? this.defaultActor.fromId ?? `29:${aadObjectId}`,
        aadObjectId,
        name: input.fromName ?? this.defaultActor.fromName ?? 'Emulated Teams User',
      },
      recipient: { id: `28:${audience}`, name: 'AlgaPSA' },
      conversation: {
        id: input.conversationId ?? this.defaultActor.conversationId ?? this.newId('conversation'),
        conversationType,
        tenantId,
        isGroup: conversationType !== 'personal',
      },
      channelData: { tenant: { id: tenantId } },
      locale: 'en-US',
      text: input.text ?? '',
      ...(input.value ? { value: input.value } : {}),
    };
    return {
      activity,
      targetUrl: input.targetUrl ?? this.botConfig.targetUrl,
      serviceUrl,
      audience,
      aadObjectId,
      tenantId,
    };
  }
}

/** Vendor-surface representation: channels are served on a sub-route. */
export function publicTeam(team: GraphTeam): Omit<GraphTeam, 'channels'> {
  const { channels: _channels, ...rest } = team;
  return rest;
}

/** Vendor-surface representation: the owning client id stays internal. */
export function publicSubscription(subscription: GraphSubscription): Omit<GraphSubscription, 'clientId'> {
  const { clientId: _clientId, ...rest } = subscription;
  return rest;
}

/** Vendor-surface event: the linked online-meeting id stays internal. */
export function publicEvent(event: GraphCalendarEvent): Omit<GraphCalendarEvent, 'organizerUserId' | 'onlineMeetingId'> {
  const { organizerUserId: _organizer, onlineMeetingId: _meetingId, ...rest } = event;
  return rest;
}

/** Vendor-surface online meeting: the organizer path segment stays internal. */
export function publicOnlineMeeting(meeting: GraphOnlineMeeting): Omit<GraphOnlineMeeting, 'organizerUserId'> {
  const { organizerUserId: _organizer, ...rest } = meeting;
  return rest;
}
