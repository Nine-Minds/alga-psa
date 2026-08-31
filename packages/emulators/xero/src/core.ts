import type { EmulatorCore, HostEnv } from '@alga-psa/emulator-host';

/** Xero-shaped error the wire shell serializes. */
export class XeroWireError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(typeof body.Detail === 'string' ? body.Detail : typeof body.error === 'string' ? body.error : `HTTP ${status}`);
    this.name = 'XeroWireError';
  }
}

export interface XeroAuthorizeRequest {
  clientId: string;
  scope: string;
  state: string;
  redirectUri: string;
  code: string;
  query: Record<string, string>;
}

export interface XeroOrganisation {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantType: 'ORGANISATION';
}

interface OrgData {
  invoices: Map<string, Record<string, unknown>>;
  contacts: Map<string, Record<string, unknown>>;
}

export interface XeroTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'Bearer';
  scope: string;
}

const DEFAULT_SCOPE = 'offline_access accounting.settings.read accounting.invoices accounting.contacts';

/**
 * Pure state machine behind the Xero vendor surface: the identity authorize +
 * token endpoints, the connections list, and the accounting API entities the
 * shipped integration touches (Invoices, Contacts, and read-only settings).
 * Time flows through env.clock, randomness through env.rng.
 */
export class XeroEmulatorCore implements EmulatorCore {
  accessTokenTtlSeconds = 1800;
  authorizeRequests: XeroAuthorizeRequest[] = [];
  private codes = new Map<string, { clientId: string; scope: string }>();
  private accessTokens = new Map<string, { expiresAt: number; scope: string }>();
  private refreshTokens = new Map<string, { scope: string }>();
  private organisations: XeroOrganisation[] = [];
  private orgData = new Map<string, OrgData>();
  private invoiceNumberCounter = 0;
  private idCounter = 0;

  constructor(readonly env: HostEnv) {
    this.reset();
  }

  reset(): void {
    this.authorizeRequests = [];
    this.codes.clear();
    this.accessTokens.clear();
    this.refreshTokens.clear();
    this.organisations = [];
    this.orgData.clear();
    this.invoiceNumberCounter = 0;
    this.accessTokenTtlSeconds = 1800;
    // One organisation out of the box so the callback's non-empty connections
    // requirement holds without seeding; seed more for multi-org flows.
    this.seedOrganisation({ tenantName: 'Alga Emulated Org' });
  }

  private newId(prefix: string): string {
    this.idCounter += 1;
    const entropy = Math.floor(this.env.rng() * 0xffffffff).toString(16).padStart(8, '0');
    return `${prefix}-${this.idCounter.toString(36)}-${entropy}`;
  }

  private nowMs(): number {
    return this.env.clock.now().getTime();
  }

  // --- OAuth (identity.xero.com authorize + connect/token) ---

  authorize(query: Record<string, string>): { redirectUri: string; code: string; state: string } {
    const redirectUri = query.redirect_uri ?? '';
    if (!query.client_id || !redirectUri) {
      throw new XeroWireError(400, { error: 'invalid_request', Detail: 'client_id and redirect_uri are required' });
    }
    const code = this.newId('code');
    const scope = query.scope ?? '';
    this.authorizeRequests.push({
      clientId: query.client_id,
      scope,
      state: query.state ?? '',
      redirectUri,
      code,
      query,
    });
    this.codes.set(code, { clientId: query.client_id, scope });
    return { redirectUri, code, state: query.state ?? '' };
  }

  grantToken(params: Record<string, string>): XeroTokenResponse {
    if (params.grant_type === 'authorization_code') {
      const record = this.codes.get(String(params.code));
      if (!record) {
        throw new XeroWireError(400, { error: 'invalid_grant' });
      }
      this.codes.delete(String(params.code));
      return this.issueTokens(record.scope || DEFAULT_SCOPE);
    }
    if (params.grant_type === 'refresh_token') {
      const record = this.refreshTokens.get(String(params.refresh_token));
      if (!record) {
        throw new XeroWireError(400, { error: 'invalid_grant' });
      }
      this.refreshTokens.delete(String(params.refresh_token));
      return this.issueTokens(record.scope);
    }
    throw new XeroWireError(400, { error: 'unsupported_grant_type' });
  }

  private issueTokens(scope: string): XeroTokenResponse {
    const accessToken = this.newId('access');
    const refreshToken = this.newId('refresh');
    this.accessTokens.set(accessToken, { expiresAt: this.nowMs() + this.accessTokenTtlSeconds * 1000, scope });
    this.refreshTokens.set(refreshToken, { scope });
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: this.accessTokenTtlSeconds,
      token_type: 'Bearer',
      scope,
    };
  }

  authenticate(bearerToken: string): { scope: string } {
    const record = this.accessTokens.get(bearerToken);
    if (!record || record.expiresAt <= this.nowMs()) {
      throw new XeroWireError(401, { Type: null, Title: 'Unauthorized', Status: 401, Detail: 'AuthenticationUnsuccessful' });
    }
    return record;
  }

  expireAccessTokens(): number {
    for (const token of this.accessTokens.values()) {
      token.expiresAt = 0;
    }
    return this.accessTokens.size;
  }

  tokens(): { accessTokens: Array<{ token: string; expiresAt: string; scope: string }>; refreshTokens: Array<{ token: string; scope: string }> } {
    return {
      accessTokens: [...this.accessTokens.entries()].map(([token, record]) => ({
        token,
        expiresAt: new Date(record.expiresAt).toISOString(),
        scope: record.scope,
      })),
      refreshTokens: [...this.refreshTokens.entries()].map(([token, record]) => ({ token, scope: record.scope })),
    };
  }

  // --- Organisations (api.xero.com/connections) ---

  seedOrganisation(params: { tenantId?: string; tenantName: string }): XeroOrganisation {
    const organisation: XeroOrganisation = {
      id: this.newId('conn'),
      tenantId: params.tenantId ?? this.newId('tenant'),
      tenantName: params.tenantName,
      tenantType: 'ORGANISATION',
    };
    this.organisations.push(organisation);
    this.orgData.set(organisation.tenantId, { invoices: new Map(), contacts: new Map() });
    return organisation;
  }

  connections(): XeroOrganisation[] {
    return [...this.organisations];
  }

  org(xeroTenantId: string): OrgData {
    const data = this.orgData.get(xeroTenantId);
    if (!data) {
      throw new XeroWireError(403, {
        Type: null,
        Title: 'Forbidden',
        Status: 403,
        Detail: `Tenant ${xeroTenantId} is not connected`,
      });
    }
    return data;
  }

  get defaultTenantId(): string {
    return this.organisations[0]!.tenantId;
  }

  // --- Settings collections (read-only, sensible small defaults) ---

  accounts(): Array<Record<string, unknown>> {
    return [
      { AccountID: 'acct-sales', Code: '200', Name: 'Sales', Type: 'REVENUE', Status: 'ACTIVE' },
      { AccountID: 'acct-other-revenue', Code: '260', Name: 'Other Revenue', Type: 'REVENUE', Status: 'ACTIVE' },
      { AccountID: 'acct-old-sales', Code: '299', Name: 'Legacy Sales', Type: 'REVENUE', Status: 'ARCHIVED' },
    ];
  }

  taxRates(): Array<Record<string, unknown>> {
    return [
      {
        TaxRateID: 'taxrate-output',
        Name: 'Tax on Sales',
        TaxType: 'OUTPUT',
        Status: 'ACTIVE',
        EffectiveRate: 8.25,
        TaxComponents: [
          { Name: 'State Tax', Rate: 6.25 },
          { Name: 'Local Tax', Rate: 2 },
        ],
      },
      { TaxRateID: 'taxrate-none', Name: 'No Tax', TaxType: 'NONE', Status: 'ACTIVE', EffectiveRate: 0, TaxComponents: [] },
    ];
  }

  items(): Array<Record<string, unknown>> {
    return [
      { ItemID: 'item-consulting', Code: 'CONSULT', Name: 'Consulting Services', Status: 'ACTIVE', IsTrackedAsInventory: false },
      { ItemID: 'item-managed', Code: 'MSP', Name: 'Managed Services', Status: 'ACTIVE', IsTrackedAsInventory: false },
    ];
  }

  trackingCategories(): Array<Record<string, unknown>> {
    return [
      {
        TrackingCategoryID: 'tracking-region',
        Name: 'Region',
        Status: 'ACTIVE',
        Options: [
          { TrackingOptionID: 'tracking-region-east', Name: 'East', Status: 'ACTIVE' },
          { TrackingOptionID: 'tracking-region-west', Name: 'West', Status: 'ACTIVE' },
        ],
      },
    ];
  }

  // --- Invoices ---

  upsertInvoice(xeroTenantId: string, payload: Record<string, unknown>): Record<string, unknown> {
    const data = this.org(xeroTenantId);
    const existingId = typeof payload.InvoiceID === 'string' ? payload.InvoiceID : undefined;
    if (existingId && !data.invoices.has(existingId)) {
      throw new XeroWireError(404, { Type: null, Title: 'Not Found', Status: 404, Detail: `Invoice ${existingId} not found` });
    }
    const invoiceId = existingId ?? this.newId('inv');
    this.invoiceNumberCounter += 1;
    const existing = existingId ? data.invoices.get(existingId) : undefined;
    const invoice: Record<string, unknown> = {
      ...existing,
      ...payload,
      InvoiceID: invoiceId,
      InvoiceNumber:
        payload.InvoiceNumber ?? existing?.InvoiceNumber ?? `INV-${String(this.invoiceNumberCounter).padStart(4, '0')}`,
      Status: payload.Status ?? existing?.Status ?? 'DRAFT',
      LineItems: (Array.isArray(payload.LineItems) ? payload.LineItems : []).map((line: Record<string, unknown>) => ({
        ...line,
        LineItemID: typeof line.LineItemID === 'string' ? line.LineItemID : this.newId('line'),
      })),
      UpdatedDateUTC: this.env.clock.now().toISOString(),
    };
    data.invoices.set(invoiceId, invoice);
    return invoice;
  }

  getInvoice(xeroTenantId: string, invoiceId: string): Record<string, unknown> {
    const invoice = this.org(xeroTenantId).invoices.get(invoiceId);
    if (!invoice) {
      throw new XeroWireError(404, { Type: null, Title: 'Not Found', Status: 404, Detail: `Invoice ${invoiceId} not found` });
    }
    return invoice;
  }

  invoices(): Array<Record<string, unknown>> {
    return [...this.orgData.entries()].flatMap(([tenantId, data]) =>
      [...data.invoices.values()].map((invoice) => ({ xeroTenantId: tenantId, ...invoice })),
    );
  }

  // --- Contacts ---

  upsertContact(xeroTenantId: string, payload: Record<string, unknown>): Record<string, unknown> {
    const data = this.org(xeroTenantId);
    const name = typeof payload.Name === 'string' ? payload.Name : '';
    if (!name) {
      throw new XeroWireError(400, { Type: 'ValidationException', Title: 'A validation exception occurred', Status: 400, Detail: 'Contact Name is required' });
    }
    const existing = [...data.contacts.values()].find((contact) => contact.Name === name);
    const contactId = typeof payload.ContactID === 'string' ? payload.ContactID : (existing?.ContactID as string | undefined) ?? this.newId('contact');
    const contact: Record<string, unknown> = {
      ...existing,
      ...payload,
      ContactID: contactId,
      ContactStatus: payload.ContactStatus ?? existing?.ContactStatus ?? 'ACTIVE',
      UpdatedDateUTC: this.env.clock.now().toISOString(),
    };
    data.contacts.set(contactId, contact);
    return contact;
  }

  /** `where` supports the one shape the client sends: Name=="..." (escaped quotes included). */
  queryContacts(xeroTenantId: string, where?: string): Array<Record<string, unknown>> {
    const all = [...this.org(xeroTenantId).contacts.values()];
    if (!where) {
      return all;
    }
    const match = where.match(/^Name=="(.*)"$/s);
    if (!match) {
      throw new XeroWireError(400, {
        Type: 'QueryParseException',
        Title: 'Unsupported where clause',
        Status: 400,
        Detail: `Xero emulator does not model where clause "${where}" — extend queryContacts deliberately`,
      });
    }
    const name = match[1].replace(/\\"/g, '"');
    return all.filter((contact) => contact.Name === name);
  }

  contacts(): Array<Record<string, unknown>> {
    return [...this.orgData.entries()].flatMap(([tenantId, data]) =>
      [...data.contacts.values()].map((contact) => ({ xeroTenantId: tenantId, ...contact })),
    );
  }
}
