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
}

export interface SeedMessageInput {
  id?: string;
  subject?: string;
  body?: string;
  from?: string;
  to?: string;
  receivedDateTime?: string;
}

/**
 * Pure state machine for the emulated Microsoft login + Graph service.
 * All time flows through the host clock, so `algasim clock advance 2h`
 * expires access tokens and subscriptions exactly like real elapsed time.
 */
export class MsGraphCore implements EmulatorCore {
  private readonly clients = new Map<string, string>();
  private readonly codes = new Map<string, { clientId: string; redirectUri: string }>();
  private readonly refreshTokens = new Map<string, { clientId: string; revoked: boolean }>();
  private readonly accessTokens = new Map<string, { clientId: string; expiresAt: number }>();
  readonly messages = new Map<string, GraphMessage>();
  readonly subscriptions = new Map<string, GraphSubscription>();
  readonly faults = new Map<string, OperationFault>();
  accessTokenTtlSeconds = 3600;
  rotateRefreshTokens = true;
  private idCounter = 0;

  constructor(readonly env: HostEnv) {}

  reset(): void {
    this.clients.clear();
    this.codes.clear();
    this.refreshTokens.clear();
    this.accessTokens.clear();
    this.messages.clear();
    this.subscriptions.clear();
    this.faults.clear();
    this.accessTokenTtlSeconds = 3600;
    this.rotateRefreshTokens = true;
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

  authorize(clientId: string, redirectUri: string): string {
    if (!this.clients.has(clientId)) {
      throw new GraphApiError(400, { error: 'invalid_client' });
    }
    const code = this.newId('code');
    this.codes.set(code, { clientId, redirectUri });
    return code;
  }

  grantToken(input: TokenGrantInput): { access_token: string; refresh_token: string; expires_in: number; token_type: 'Bearer' } {
    if (this.clients.get(String(input.client_id)) !== String(input.client_secret)) {
      throw new GraphApiError(401, { error: 'invalid_client' });
    }
    if (input.grant_type === 'authorization_code') {
      const code = this.codes.get(String(input.code));
      if (!code || code.clientId !== input.client_id || code.redirectUri !== input.redirect_uri) {
        throw new GraphApiError(400, { error: 'invalid_grant' });
      }
      this.codes.delete(String(input.code));
      return this.issueTokens(String(input.client_id));
    }
    if (input.grant_type === 'refresh_token') {
      const refresh = this.refreshTokens.get(String(input.refresh_token));
      if (!refresh || refresh.revoked || refresh.clientId !== input.client_id) {
        throw new GraphApiError(400, { error: 'invalid_grant' });
      }
      return this.issueTokens(String(input.client_id), String(input.refresh_token));
    }
    throw new GraphApiError(400, { error: 'unsupported_grant_type' });
  }

  private issueTokens(clientId: string, existingRefreshToken?: string) {
    const accessToken = this.newId('access');
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
}

/** Vendor-surface representation: the owning client id stays internal. */
export function publicSubscription(subscription: GraphSubscription): Omit<GraphSubscription, 'clientId'> {
  const { clientId: _clientId, ...rest } = subscription;
  return rest;
}
