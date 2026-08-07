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
  private readonly clients = new Map<string, string>();
  private readonly codes = new Map<string, {
    clientId: string;
    redirectUri: string;
    nonce?: string;
    scope?: string;
  }>();
  private readonly refreshTokens = new Map<string, { clientId: string; revoked: boolean }>();
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
  readonly botConversations = new Map<string, BotConversation>();
  readonly capturedBotActivities: CapturedBotActivity[] = [];
  readonly activityNotifications: ActivityNotificationRecord[] = [];
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
    this.botConversations.clear();
    this.capturedBotActivities.length = 0;
    this.activityNotifications.length = 0;
    this.faults.clear();
    this.accessTokenTtlSeconds = 3600;
    this.rotateRefreshTokens = true;
    // Deliberately does not rotate the Bot Framework signing key: the app
    // caches the JWKS for 12h, so a reset between tests must not invalidate
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

  registerClient(clientId: string, clientSecret: string): void {
    this.clients.set(clientId, clientSecret);
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
    /** Absent for the app-only client_credentials grant, exactly like Entra. */
    refresh_token?: string;
    expires_in: number;
    token_type: 'Bearer';
    id_token?: string;
  } {
    if (this.clients.get(String(input.client_id)) !== String(input.client_secret)) {
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
      return this.issueTokens(String(input.client_id), String(input.refresh_token));
    }
    if (input.grant_type === 'client_credentials') {
      // App-only flow used by the Teams bot connector
      // (scope https://api.botframework.com/.default) and by Graph
      // app tokens. No user, so no refresh token is issued.
      const { refresh_token: issuedRefreshToken, ...appOnly } = this.issueTokens(
        String(input.client_id),
        undefined,
        { scope: input.scope || 'https://graph.microsoft.com/.default' },
      );
      this.refreshTokens.delete(issuedRefreshToken);
      return appOnly;
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
    claims?: { nonce?: string; scope?: string }
  ) {
    const tenantId = EMULATED_TENANT_ID;
    const accessToken = this.encodeJwt({
      tid: tenantId,
      iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      scp: claims?.scope || 'Mail.Read Mail.Read.Shared offline_access',
      aud: '00000003-0000-0000-c000-000000000000',
      exp: Math.floor((this.nowMs() + this.accessTokenTtlSeconds * 1000) / 1000),
    });
    const refreshToken =
      existingRefreshToken && !this.rotateRefreshTokens ? existingRefreshToken : this.newId('refresh');
    this.accessTokens.set(accessToken, {
      clientId,
      expiresAt: this.nowMs() + this.accessTokenTtlSeconds * 1000,
    });
    this.refreshTokens.set(refreshToken, { clientId, revoked: false });
    if (existingRefreshToken && existingRefreshToken !== refreshToken) {
      this.refreshTokens.delete(existingRefreshToken);
    }
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
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

  /** Consume one occurrence of an operation-scoped fault, if armed. */
  consumeFault(operation: string): OperationFault | null {
    const fault = this.faults.get(operation);
    if (!fault) return null;
    if (fault.remaining !== undefined) {
      fault.remaining -= 1;
      if (fault.remaining <= 0) this.faults.delete(operation);
    }
    return fault;
  }

  // --- Mail ---

  addMessage(input: SeedMessageInput): GraphMessage {
    const id = input.id ?? this.newId('message');
    const message: GraphMessage = {
      id,
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

  /**
   * Assemble the Bot Framework Activity that inbound injection delivers to the
   * app's bot endpoint. Pure: the notifier signs it and performs the POST.
   */
  buildInboundActivity(input: InboundBotActivityInput): {
    activity: Record<string, unknown>;
    targetUrl: string;
    serviceUrl: string;
    audience: string;
    aadObjectId: string;
    tenantId: string;
  } {
    const serviceUrl = input.serviceUrl ?? this.botConfig.serviceUrl;
    const tenantId = input.tenantId ?? this.botConfig.tenantId;
    const audience = input.appId ?? this.botConfig.appId;
    const aadObjectId = input.fromAadObjectId ?? this.newId('aad-object');
    const conversationType = input.conversationType ?? 'personal';
    const activity: Record<string, unknown> = {
      type: input.type ?? 'message',
      id: this.newId('inbound-activity'),
      timestamp: this.env.clock.now().toISOString(),
      channelId: 'msteams',
      serviceUrl,
      from: {
        id: input.fromId ?? `29:${aadObjectId}`,
        aadObjectId,
        name: input.fromName ?? 'Emulated Teams User',
      },
      recipient: { id: `28:${audience}`, name: 'AlgaPSA' },
      conversation: {
        id: input.conversationId ?? this.newId('conversation'),
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
