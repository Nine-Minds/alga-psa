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
  /**
   * TaxCode id AST resolves a TAX-marked (or code-less) line to, standing in
   * for Intuit's jurisdiction lookup. Null turns Automated Sales Tax off, so
   * created invoices carry no TxnTaxDetail — the non-AST company file.
   */
  automatedSalesTaxDefaultTaxCodeId: string | null;
}

/**
 * OAuth + realm shell around the billing-owned QboSimulator. The simulator
 * carries all QBO domain semantics (SyncTokens, duplicate names, computed
 * totals, balances, credits, CDC); this core adds what a wire deployment
 * needs: client credentials, bearer tokens on the host clock, and reset.
 */
export class QboEmulatorCore implements EmulatorCore {
  readonly realmId = 'realm-sim';
  /** Which company the "user" picks in the authorize flow (Intuit's company picker). */
  authorizeRealmId: string | null = null;
  accessTokenTtlSeconds = 3600;
  private readonly sims = new Map<string, QboSimulator>();
  private readonly clients = new Map<string, string>();
  private readonly authCodes = new Map<string, { clientId: string; redirectUri: string }>();
  private readonly accessTokens = new Map<string, { clientId: string; expiresAt: number }>();
  private readonly refreshTokens = new Map<string, { clientId: string; revoked: boolean }>();
  private idCounter = 0;

  constructor(readonly env: HostEnv) {
    this.sims.set(this.realmId, new QboSimulator({ realmId: this.realmId }));
  }

  /** The default company file — most scenarios only ever use this one. */
  get sim(): QboSimulator {
    return this.sims.get(this.realmId)!;
  }

  /**
   * Resolve a company file by realm. Unknown realms fail exactly like Intuit
   * rejecting a realm the connection is not authorized for.
   */
  simFor(realmId?: string | null): QboSimulator {
    const sim = this.sims.get(realmId ?? this.realmId);
    if (!sim) {
      throw new QboWireError(403, '3202', `Realm ${realmId} is not authorized for this connection`);
    }
    return sim;
  }

  /** Add (or reset) a separately-stated company file under its own realm id. */
  addRealm(realmId: string): { realmId: string } {
    this.sims.set(realmId, new QboSimulator({ realmId }));
    return { realmId };
  }

  realmIds(): string[] {
    return [...this.sims.keys()];
  }

  reset(): void {
    this.sims.clear();
    this.sims.set(this.realmId, new QboSimulator({ realmId: this.realmId }));
    this.clients.clear();
    this.authCodes.clear();
    this.accessTokens.clear();
    this.refreshTokens.clear();
    this.accessTokenTtlSeconds = 3600;
    this.authorizeRealmId = null;
  }

  configure(config: Partial<QboEmulatorConfig>, realmId?: string | null): QboEmulatorConfig {
    const sim = this.simFor(realmId);
    if (config.autoApplyCredits !== undefined) {
      sim.options.autoApplyCredits = config.autoApplyCredits;
    }
    if (config.taxAdjustmentCents !== undefined) {
      sim.options.taxAdjustmentCents = config.taxAdjustmentCents;
    }
    if (config.automatedSalesTaxDefaultTaxCodeId !== undefined) {
      sim.options.automatedSalesTax = config.automatedSalesTaxDefaultTaxCodeId
        ? { defaultTaxCodeId: config.automatedSalesTaxDefaultTaxCodeId }
        : undefined;
    }
    return this.config(realmId);
  }

  config(realmId?: string | null): QboEmulatorConfig {
    const sim = this.simFor(realmId);
    return {
      autoApplyCredits: Boolean(sim.options.autoApplyCredits),
      taxAdjustmentCents: sim.options.taxAdjustmentCents ?? 0,
      automatedSalesTaxDefaultTaxCodeId: sim.options.automatedSalesTax?.defaultTaxCodeId ?? null,
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
