import { QboSimulator } from '@alga-psa/billing/testing/qboSimulator';
import type { EmulatorCore, HostEnv } from '@alga-psa/emulator-host';

/** Intuit fault envelope the wire shell serializes. */
export class QboWireError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'QboWireError';
  }

  toFault(): { Fault: { Error: Array<{ Message: string; Detail: string; code: string }>; type: string } } {
    return {
      Fault: {
        Error: [{ Message: this.message, Detail: this.detail ?? this.message, code: this.code }],
        type: 'ValidationFault',
      },
    };
  }
}

export interface QboEmulatorConfig {
  autoApplyCredits: boolean;
  taxAdjustmentCents: number;
}

/**
 * OAuth + realm shell around the billing-owned QboSimulator. The simulator
 * carries all QBO domain semantics (SyncTokens, duplicate names, computed
 * totals, balances, credits, CDC); this core adds what a wire deployment
 * needs: client credentials, bearer tokens on the host clock, and reset.
 */
export class QboEmulatorCore implements EmulatorCore {
  sim: QboSimulator;
  readonly realmId = 'realm-sim';
  accessTokenTtlSeconds = 3600;
  private readonly clients = new Map<string, string>();
  private readonly authCodes = new Map<string, { clientId: string; redirectUri: string }>();
  private readonly accessTokens = new Map<string, { clientId: string; expiresAt: number }>();
  private readonly refreshTokens = new Map<string, { clientId: string; revoked: boolean }>();
  private idCounter = 0;

  constructor(readonly env: HostEnv) {
    this.sim = new QboSimulator({ realmId: this.realmId });
  }

  reset(): void {
    this.sim = new QboSimulator({ realmId: this.realmId });
    this.clients.clear();
    this.authCodes.clear();
    this.accessTokens.clear();
    this.refreshTokens.clear();
    this.accessTokenTtlSeconds = 3600;
  }

  configure(config: Partial<QboEmulatorConfig>): QboEmulatorConfig {
    if (config.autoApplyCredits !== undefined) {
      this.sim.options.autoApplyCredits = config.autoApplyCredits;
    }
    if (config.taxAdjustmentCents !== undefined) {
      this.sim.options.taxAdjustmentCents = config.taxAdjustmentCents;
    }
    return this.config();
  }

  config(): QboEmulatorConfig {
    return {
      autoApplyCredits: Boolean(this.sim.options.autoApplyCredits),
      taxAdjustmentCents: this.sim.options.taxAdjustmentCents ?? 0,
    };
  }

  private newId(prefix: string): string {
    this.idCounter += 1;
    const entropy = Math.floor(this.env.rng() * 0xffffffff).toString(16).padStart(8, '0');
    return `${prefix}-${this.idCounter.toString(36)}-${entropy}`;
  }

  private nowMs(): number {
    return this.env.clock.now().getTime();
  }

  // --- OAuth (Intuit appcenter authorize + oauth.platform token endpoint) ---

  registerClient(clientId: string, clientSecret: string): void {
    this.clients.set(clientId, clientSecret);
  }

  authorize(clientId: string, redirectUri: string): string {
    if (!this.clients.has(clientId)) {
      throw new QboWireError(400, '3200', 'invalid_client');
    }
    const code = this.newId('code');
    this.authCodes.set(code, { clientId, redirectUri });
    return code;
  }

  /** Token grants authenticate with HTTP Basic (clientId:clientSecret), like Intuit. */
  grantToken(basicClientId: string, basicClientSecret: string, params: Record<string, string>): {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
    token_type: 'bearer';
  } {
    if (this.clients.get(basicClientId) !== basicClientSecret) {
      throw new QboWireError(401, '3200', 'invalid_client');
    }
    if (params.grant_type === 'authorization_code') {
      const code = this.authCodes.get(String(params.code));
      if (!code || code.clientId !== basicClientId || code.redirectUri !== params.redirect_uri) {
        throw new QboWireError(400, '3200', 'invalid_grant');
      }
      this.authCodes.delete(String(params.code));
      return this.issueTokens(basicClientId);
    }
    if (params.grant_type === 'refresh_token') {
      const refresh = this.refreshTokens.get(String(params.refresh_token));
      if (!refresh || refresh.revoked || refresh.clientId !== basicClientId) {
        throw new QboWireError(400, '3200', 'invalid_grant');
      }
      this.refreshTokens.delete(String(params.refresh_token));
      return this.issueTokens(basicClientId);
    }
    throw new QboWireError(400, '3200', 'unsupported_grant_type');
  }

  /** Mint a token set directly, skipping the browser flow — for test wiring. */
  mintTokens(clientId: string): ReturnType<QboEmulatorCore['grantToken']> & { realmId: string } {
    if (!this.clients.has(clientId)) {
      throw new QboWireError(400, '3200', `Unknown client "${clientId}" — seed it first`);
    }
    return { ...this.issueTokens(clientId), realmId: this.realmId };
  }

  private issueTokens(clientId: string) {
    const accessToken = this.newId('access');
    const refreshToken = this.newId('refresh');
    this.accessTokens.set(accessToken, { clientId, expiresAt: this.nowMs() + this.accessTokenTtlSeconds * 1000 });
    this.refreshTokens.set(refreshToken, { clientId, revoked: false });
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: this.accessTokenTtlSeconds,
      x_refresh_token_expires_in: 8_726_400,
      token_type: 'bearer' as const,
    };
  }

  authenticate(bearerToken: string): { clientId: string } {
    const record = this.accessTokens.get(bearerToken);
    if (!record || record.expiresAt <= this.nowMs()) {
      throw new QboWireError(401, '3200', 'message=AuthenticationFailed; errorCode=003200');
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
}
