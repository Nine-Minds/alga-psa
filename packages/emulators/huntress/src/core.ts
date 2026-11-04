import type { EmulatorCore, HostEnv } from '@alga-psa/emulator-host';

/**
 * Huntress-shaped error the wire shell serializes. Huntress documents response
 * *codes* per operation (403 "There was an issue with your API credential or
 * permissions.", 404 "Not Found", 429, 5xx) but never a JSON error body, so the
 * `{ error }` envelope below is an emulator choice — see PROTOCOL_PARITY.md.
 */
export class HuntressWireError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly headers: Record<string, string> = {},
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'HuntressWireError';
  }

  toEnvelope(): { error: string; code?: string } {
    return { error: this.message, ...(this.code ? { code: this.code } : {}) };
  }
}

/** The 403 description every documented operation carries. */
export const HUNTRESS_CREDENTIAL_ERROR = 'There was an issue with your API credential or permissions.';
/** The general-table description for 404 (no per-operation GET body is documented). */
export const HUNTRESS_NOT_FOUND_ERROR = 'Not Found';

// ── Documented enums (api.huntress.io/v1/swagger_doc.json) ────────────────

export const HUNTRESS_SEVERITIES = ['low', 'high', 'critical'] as const;
export type HuntressSeverity = (typeof HUNTRESS_SEVERITIES)[number];

/**
 * `sent|closed|dismissed|auto_remediating|deleting|partner_dismissed` is the
 * documented `status` filter enum; `draft` only appears in the IncidentReport
 * model and is served by the by-id endpoint alone.
 */
export const HUNTRESS_INCIDENT_FILTER_STATUSES = [
  'sent',
  'closed',
  'dismissed',
  'auto_remediating',
  'deleting',
  'partner_dismissed',
] as const;
export const HUNTRESS_INCIDENT_STATUSES = [...HUNTRESS_INCIDENT_FILTER_STATUSES, 'draft'] as const;
export type HuntressIncidentStatus = (typeof HUNTRESS_INCIDENT_STATUSES)[number];

export const HUNTRESS_INDICATOR_TYPES = [
  'footholds',
  'monitored_files',
  'ransomware_canaries',
  'antivirus_detections',
  'process_detections',
  'managed_identity',
  'mde_detections',
  'siem_detections',
  'favicon_detections',
  'behavioral_detections',
  'email_security_detections',
  'app_control',
  'ai_misuse',
] as const;
export type HuntressIndicatorType = (typeof HUNTRESS_INDICATOR_TYPES)[number];

export const HUNTRESS_INCIDENT_PLATFORMS = [
  'windows',
  'darwin',
  'microsoft_365',
  'google',
  'linux',
  'email_security',
  'other',
] as const;
export const HUNTRESS_AGENT_PLATFORMS = ['windows', 'darwin', 'linux'] as const;

export const HUNTRESS_ESCALATION_STATUSES = ['open', 'overdue', 'resolved'] as const;
export type HuntressEscalationStatus = (typeof HUNTRESS_ESCALATION_STATUSES)[number];

export const HUNTRESS_DETERMINATIONS = ['expected', 'unauthorized'] as const;
export type HuntressDetermination = (typeof HUNTRESS_DETERMINATIONS)[number];
export const HUNTRESS_RESOLUTION_SCOPES = ['account', 'organization', 'identity'] as const;
export type HuntressResolutionScope = (typeof HUNTRESS_RESOLUTION_SCOPES)[number];
export const HUNTRESS_RESOLUTION_METHODS = ['rule', 'dismiss', 'direct'] as const;
export type HuntressResolutionMethod = (typeof HUNTRESS_RESOLUTION_METHODS)[number];

/**
 * The escalation types the resolution endpoint documents as accepting
 * `determination`/`scope` ("Unwanted Country Access", "Unwanted VPN Access");
 * `unexpected_country_access` is the `type_code` the schema uses as its
 * example.
 */
export const HUNTRESS_UNWANTED_ACCESS_TYPE_CODES = [
  'unexpected_country_access',
  'unwanted_country_access',
  'unwanted_vpn_access',
] as const;

export const HUNTRESS_ACCOUNT_STATUSES = ['enabled', 'disabled'] as const;
export const HUNTRESS_SUPPORT_TYPES = ['huntress_supported', 'partner_supported', 'not_applicable'] as const;

/** Documented `sort_field` enums, per resource. */
export const HUNTRESS_SORT_FIELDS = {
  organizations: ['id', 'created_at', 'updated_at', 'name', 'key'],
  agents: ['id', 'created_at', 'updated_at'],
  incident_reports: ['id', 'created_at', 'updated_at'],
  escalations: ['id', 'severity', 'due_at', 'created_at', 'updated_at'],
} as const;
export type HuntressResource = keyof typeof HUNTRESS_SORT_FIELDS;

// ── Vendor resources ──────────────────────────────────────────────────────

export interface HuntressAddress {
  [key: string]: unknown;
}

export interface HuntressAccountRecord {
  id: number;
  name: string;
  subdomain: string;
  status: (typeof HUNTRESS_ACCOUNT_STATUSES)[number];
  support_type: (typeof HUNTRESS_SUPPORT_TYPES)[number];
  neighborhood_watch: Record<string, number>;
  billing_address: HuntressAddress | null;
  shipping_address: HuntressAddress | null;
  [key: string]: unknown;
}

export interface HuntressOrganizationRecord {
  id: number;
  account_id: number;
  name: string;
  key: string;
  agents_count: number;
  incident_reports_count: number;
  logs_sources_count: number;
  identity_provider_tenant_id: string | null;
  billable_identity_count: number;
  sat_learner_count: number;
  report_recipients: string[];
  created_at: string;
  updated_at: string;
  /** Detail-only (OrganizationWithActualProductUsages); omitted when unseeded. */
  actual_usages?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface HuntressAgentRecord {
  id: number;
  account_id: number;
  organization_id: number | null;
  hostname: string;
  platform: string;
  os: string | null;
  os_major: number | null;
  os_minor: number | null;
  os_patch: number | null;
  os_build_version: string | null;
  arch: string | null;
  version: string | null;
  edr_version: string | null;
  external_ip: string | null;
  ipv4_address: string | null;
  ipv4_addresses: string[];
  mac_addresses: string[];
  serial_number: string | null;
  domain_name: string | null;
  defender_status: string | null;
  defender_substatus: string | null;
  defender_policy_status: string | null;
  firewall_status: string | null;
  tamper_protection_configured: boolean | null;
  tamper_protection_actual: boolean | null;
  service_pack_major: number | null;
  service_pack_minor: number | null;
  version_number: number | null;
  win_build_number: number | null;
  tags: string[];
  last_callback_at: string | null;
  last_survey_at: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface HuntressRemediationParameter {
  name: string;
  description: string;
}

export interface HuntressRemediationRecord {
  id: number;
  type: string;
  action: string | null;
  status: string | null;
  parameters: HuntressRemediationParameter[];
  approved_at: string | null;
  approved_by: { id: string; email: string; name: string } | null;
  completed_at: string | null;
  [key: string]: unknown;
}

export interface HuntressIncidentRecord {
  id: number;
  account_id: number;
  agent_id: number | null;
  organization_id: number | null;
  subject: string | null;
  summary: string | null;
  body: string | null;
  severity: HuntressSeverity;
  status: HuntressIncidentStatus;
  platform: string | null;
  indicator_types: string[];
  indicator_counts: Record<string, number>;
  psa_ticket_eids: string[];
  remediations: HuntressRemediationRecord[];
  sent_at: string | null;
  closed_at: string | null;
  status_updated_at: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface HuntressEscalationEntity {
  id: number;
  type: 'Agent' | 'Identity';
  details: Record<string, unknown>;
}

export interface HuntressEscalationRecord {
  id: number;
  organization_ids: number[];
  severity: HuntressSeverity;
  status: HuntressEscalationStatus;
  subject: string;
  type: string;
  type_code: string;
  subtype: string | null;
  psa_ticket_eids: string[];
  entities: HuntressEscalationEntity[];
  created_at: string;
  resolved_at: string | null;
  updated_at: string;
  /**
   * Not part of the documented Escalation schema; `presentEscalation` strips
   * it. `due_at` only exists as a documented `sort_field`, and
   * `api_resolvable` drives the documented 422.
   */
  internal: { due_at: string | null; api_resolvable: boolean };
}

export interface HuntressResolutionParameters {
  determination?: HuntressDetermination;
  scope?: HuntressResolutionScope;
  expiration_date?: string;
  ip_address?: string;
  revoke_and_disable_identities?: boolean;
}

/** Entities are only on the by-id and resolution responses (EscalationWithEntities). */
export interface PresentedEscalation {
  id: number;
  account: { id: number; name: string };
  organizations: Array<{ id: number; name: string }>;
  created_at: string;
  resolved_at: string | null;
  severity: HuntressSeverity;
  status: HuntressEscalationStatus;
  subject: string;
  subtype: string | null;
  type: string;
  type_code: string;
  psa_ticket_eids: string[];
  updated_at: string;
  entities?: { total_count: number; has_more: boolean; items: HuntressEscalationEntity[] };
}

export interface HuntressCredential {
  key: string;
  secret: string;
  /**
   * POST /v1/escalations/{id}/resolution "requires an API key with permissions
   * to write to Escalations" and notes the default account key is read-only.
   */
  escalationsWrite: boolean;
}

export interface OperationFault {
  /** "GET /v1/incident_reports", a trailing-`*` prefix, or "*" for everything. */
  operation: string;
  status: number;
  message: string;
  retryAfterSeconds: number | null;
  remaining: number;
}

export interface AuthFailureRecord {
  at: string;
  method: string;
  path: string;
  reason: 'missing' | 'not_basic' | 'unknown_credential';
  /** Masked — fixtures are not secrets, but neither are they worth echoing. */
  authorization: string | null;
}

export interface HuntressConfig {
  credentials: HuntressCredential[];
  account: HuntressAccountRecord;
}

export const HUNTRESS_DEFAULT_API_KEY = 'algasim-huntress-key';
export const HUNTRESS_DEFAULT_API_SECRET = 'algasim-huntress-secret';

function defaultAccount(): HuntressAccountRecord {
  return {
    id: 1,
    name: 'Algasim Partner Account',
    subdomain: 'algasim',
    status: 'enabled',
    support_type: 'huntress_supported',
    neighborhood_watch: { edr: 0, ispm: 0, itdr: 0, sat: 0, siem: 0 },
    billing_address: null,
    shipping_address: null,
  };
}

function defaultConfig(): HuntressConfig {
  return {
    credentials: [
      { key: HUNTRESS_DEFAULT_API_KEY, secret: HUNTRESS_DEFAULT_API_SECRET, escalationsWrite: true },
    ],
    account: defaultAccount(),
  };
}

interface Counters {
  organization: number;
  agent: number;
  incident: number;
  escalation: number;
  remediation: number;
  entity: number;
}

function zeroCounters(): Counters {
  return { organization: 0, agent: 0, incident: 0, escalation: 0, remediation: 0, entity: 0 };
}

export interface HuntressSnapshot {
  config: HuntressConfig;
  organizations: HuntressOrganizationRecord[];
  agents: HuntressAgentRecord[];
  incidents: HuntressIncidentRecord[];
  escalations: HuntressEscalationRecord[];
  counters: Counters;
}

export interface PaginatedPage<T> {
  items: T[];
  /** null on the last page. */
  nextPageToken: string | null;
  limit: number;
}

const SEVERITY_RANK: Record<HuntressSeverity, number> = { low: 0, high: 1, critical: 2 };

/** Huntress renders timestamps as ISO-8601 with second precision and a Z. */
function iso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

type SortPrimary = string | number;
interface SortKey {
  primary: SortPrimary;
  id: number;
}

function compareKeys(a: SortKey, b: SortKey): number {
  if (typeof a.primary === 'number' && typeof b.primary === 'number') {
    if (a.primary !== b.primary) return a.primary < b.primary ? -1 : 1;
  } else {
    const left = String(a.primary);
    const right = String(b.primary);
    if (left !== right) return left < right ? -1 : 1;
  }
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}

function encodeCursor(key: SortKey): string {
  return Buffer.from(`${key.primary}|${key.id}`, 'utf8').toString('base64').replace(/=+$/, '');
}

function decodeCursor(token: string, numericPrimary: boolean): SortKey {
  const decoded = Buffer.from(token, 'base64').toString('utf8');
  const split = decoded.lastIndexOf('|');
  const id = Number(decoded.slice(split + 1));
  if (split < 0 || !Number.isFinite(id)) {
    throw new HuntressWireError(400, `Bad Request: invalid page_token "${token}"`);
  }
  const raw = decoded.slice(0, split);
  return { primary: numericPrimary ? Number(raw) : raw, id };
}

/**
 * Deterministic Huntress-shaped state machine. No I/O, no wall time
 * (`env.clock`), no `Math.random()` (`env.rng`). The wire shell adapts these
 * operations to the documented `/v1` REST surface.
 */
export class HuntressEmulatorCore implements EmulatorCore {
  readonly env: HostEnv;
  config: HuntressConfig = defaultConfig();

  readonly organizations = new Map<number, HuntressOrganizationRecord>();
  readonly agents = new Map<number, HuntressAgentRecord>();
  readonly incidents = new Map<number, HuntressIncidentRecord>();
  readonly escalations = new Map<number, HuntressEscalationRecord>();

  readonly operationFaults: OperationFault[] = [];
  readonly authFailures: AuthFailureRecord[] = [];

  private counters: Counters = zeroCounters();

  constructor(env: HostEnv) {
    this.env = env;
  }

  reset(): void {
    this.config = defaultConfig();
    this.organizations.clear();
    this.agents.clear();
    this.incidents.clear();
    this.escalations.clear();
    this.operationFaults.length = 0;
    this.authFailures.length = 0;
    this.counters = zeroCounters();
  }

  snapshot(): HuntressSnapshot {
    return structuredClone({
      config: this.config,
      organizations: [...this.organizations.values()],
      agents: [...this.agents.values()],
      incidents: [...this.incidents.values()],
      escalations: [...this.escalations.values()],
      counters: this.counters,
    });
  }

  restore(state: unknown): void {
    const snap = structuredClone(state) as HuntressSnapshot;
    this.reset();
    this.config = { ...defaultConfig(), ...snap.config };
    for (const organization of snap.organizations ?? []) this.organizations.set(organization.id, organization);
    for (const agent of snap.agents ?? []) this.agents.set(agent.id, agent);
    for (const incident of snap.incidents ?? []) this.incidents.set(incident.id, incident);
    for (const escalation of snap.escalations ?? []) this.escalations.set(escalation.id, escalation);
    this.counters = { ...zeroCounters(), ...snap.counters };
  }

  now(): Date {
    return this.env.clock.now();
  }

  nowIso(): string {
    return iso(this.now());
  }

  private nextId(kind: keyof Counters): number {
    this.counters[kind] += 1;
    return this.counters[kind];
  }

  configure(patch: {
    credentials?: HuntressCredential[];
    accountName?: string;
    accountSubdomain?: string;
    accountStatus?: (typeof HUNTRESS_ACCOUNT_STATUSES)[number];
  }): HuntressConfig {
    if (patch.credentials) this.config.credentials = patch.credentials.map((c) => ({ ...c }));
    if (patch.accountName !== undefined) this.config.account.name = patch.accountName;
    if (patch.accountSubdomain !== undefined) this.config.account.subdomain = patch.accountSubdomain;
    if (patch.accountStatus !== undefined) this.config.account.status = patch.accountStatus;
    return this.config;
  }

  setAccount(patch: Partial<HuntressAccountRecord>): HuntressAccountRecord {
    this.config.account = { ...this.config.account, ...patch };
    return this.config.account;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  /**
   * HTTP Basic: `Authorization: Basic base64(api_key:api_secret)`. Every
   * documented operation answers 403 with HUNTRESS_CREDENTIAL_ERROR when the
   * credential is missing or wrong — the docs' general table also lists a 401
   * row, but no operation declares one, so 403 is what the emulator answers.
   */
  authenticate(authorization: string | undefined, context: { method: string; path: string }): HuntressCredential {
    const header = (authorization ?? '').trim();
    const record = (reason: AuthFailureRecord['reason']): never => {
      this.authFailures.push({
        at: this.nowIso(),
        method: context.method,
        path: context.path,
        reason,
        authorization: header ? `${header.slice(0, 10)}…` : null,
      });
      throw new HuntressWireError(403, HUNTRESS_CREDENTIAL_ERROR);
    };

    if (!header) record('missing');
    const match = /^Basic\s+(\S+)$/i.exec(header);
    if (!match) record('not_basic');
    const decoded = Buffer.from(match![1], 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const key = separator < 0 ? decoded : decoded.slice(0, separator);
    const secret = separator < 0 ? '' : decoded.slice(separator + 1);
    const credential = this.config.credentials.find((c) => c.key === key && c.secret === secret);
    if (!credential) record('unknown_credential');
    return credential!;
  }

  // ── Operation faults ────────────────────────────────────────────────────

  armOperationFault(fault: OperationFault): void {
    this.operationFaults.push({ ...fault });
  }

  disarmOperationFaults(): void {
    this.operationFaults.length = 0;
  }

  /** Consumes one use of the first fault matching the operation. */
  consumeOperationFault(operation: string): OperationFault | null {
    const matches = (pattern: string) =>
      pattern === '*' ||
      pattern === operation ||
      (pattern.endsWith('*') && operation.startsWith(pattern.slice(0, -1)));
    const index = this.operationFaults.findIndex((f) => matches(f.operation));
    if (index < 0) return null;
    const fault = this.operationFaults[index];
    fault.remaining -= 1;
    if (fault.remaining <= 0) this.operationFaults.splice(index, 1);
    return { ...fault };
  }

  // ── Organizations ───────────────────────────────────────────────────────

  createOrganization(input: {
    id?: number;
    name: string;
    key?: string;
    agents_count?: number;
    incident_reports_count?: number;
    logs_sources_count?: number;
    identity_provider_tenant_id?: string | null;
    billable_identity_count?: number;
    sat_learner_count?: number;
    report_recipients?: string[];
    actual_usages?: Record<string, unknown>;
  }): HuntressOrganizationRecord {
    const id = input.id ?? this.nextId('organization');
    if (this.organizations.has(id)) {
      throw new HuntressWireError(409, `Organization ${id} already exists`);
    }
    if (input.id !== undefined) this.counters.organization = Math.max(this.counters.organization, input.id);
    const now = this.nowIso();
    const organization: HuntressOrganizationRecord = {
      id,
      account_id: this.config.account.id,
      name: input.name,
      key: input.key ?? `org${id}`,
      agents_count: input.agents_count ?? 0,
      incident_reports_count: input.incident_reports_count ?? 0,
      logs_sources_count: input.logs_sources_count ?? 0,
      identity_provider_tenant_id: input.identity_provider_tenant_id ?? null,
      billable_identity_count: input.billable_identity_count ?? 0,
      sat_learner_count: input.sat_learner_count ?? 0,
      report_recipients: input.report_recipients ?? [],
      created_at: now,
      updated_at: now,
      ...(input.actual_usages ? { actual_usages: input.actual_usages } : {}),
    };
    this.organizations.set(id, organization);
    return organization;
  }

  getOrganization(id: number): HuntressOrganizationRecord {
    const organization = this.organizations.get(id);
    if (!organization) throw new HuntressWireError(404, HUNTRESS_NOT_FOUND_ERROR);
    return organization;
  }

  /** The org disappears; incidents and escalations keep pointing at its id. */
  deleteOrganization(id: number): HuntressOrganizationRecord {
    const organization = this.getOrganization(id);
    this.organizations.delete(id);
    return organization;
  }

  /** Detail adds `actual_usages` (OrganizationWithActualProductUsages). */
  presentOrganization(
    organization: HuntressOrganizationRecord,
    options: { withUsages: boolean },
  ): HuntressOrganizationRecord {
    const out = structuredClone(organization);
    if (!options.withUsages) delete out.actual_usages;
    return out;
  }

  // ── Agents ──────────────────────────────────────────────────────────────

  createAgent(input: Partial<HuntressAgentRecord> & { hostname: string; organization_id?: number | null }): HuntressAgentRecord {
    const id = (input.id as number | undefined) ?? this.nextId('agent');
    if (this.agents.has(id)) throw new HuntressWireError(409, `Agent ${id} already exists`);
    if (input.id !== undefined) this.counters.agent = Math.max(this.counters.agent, input.id as number);
    if (input.organization_id != null) this.getOrganization(input.organization_id);
    const now = this.nowIso();
    const agent: HuntressAgentRecord = {
      account_id: this.config.account.id,
      organization_id: null,
      platform: 'windows',
      os: null,
      os_major: null,
      os_minor: null,
      os_patch: null,
      os_build_version: null,
      arch: null,
      version: null,
      edr_version: null,
      external_ip: null,
      ipv4_address: null,
      ipv4_addresses: [],
      mac_addresses: [],
      serial_number: null,
      domain_name: null,
      defender_status: null,
      defender_substatus: null,
      defender_policy_status: null,
      firewall_status: null,
      tamper_protection_configured: null,
      tamper_protection_actual: null,
      service_pack_major: null,
      service_pack_minor: null,
      version_number: null,
      win_build_number: null,
      tags: [],
      last_callback_at: now,
      last_survey_at: null,
      created_at: now,
      updated_at: now,
      ...input,
      id,
      hostname: input.hostname,
    };
    // `ipv4_address` is documented as the primary entry of `ipv4_addresses`.
    if (agent.ipv4_address && agent.ipv4_addresses.length === 0) agent.ipv4_addresses = [agent.ipv4_address];
    if (!agent.ipv4_address && agent.ipv4_addresses.length > 0) agent.ipv4_address = agent.ipv4_addresses[0];
    this.agents.set(id, agent);
    return agent;
  }

  getAgent(id: number): HuntressAgentRecord {
    const agent = this.agents.get(id);
    if (!agent) throw new HuntressWireError(404, HUNTRESS_NOT_FOUND_ERROR);
    return agent;
  }

  updateAgent(id: number, patch: Partial<HuntressAgentRecord>): HuntressAgentRecord {
    const agent = this.getAgent(id);
    const { id: _ignored, created_at: _created, ...fields } = patch;
    Object.assign(agent, fields);
    agent.updated_at = this.nowIso();
    return agent;
  }

  /** The agent is removed from Huntress; incidents keep their `agent_id`. */
  deleteAgent(id: number): HuntressAgentRecord {
    const agent = this.getAgent(id);
    this.agents.delete(id);
    return agent;
  }

  // ── Incident reports ────────────────────────────────────────────────────

  createIncident(input: {
    id?: number;
    agent_id?: number | null;
    organization_id?: number | null;
    subject?: string | null;
    summary?: string | null;
    body?: string | null;
    severity?: HuntressSeverity;
    status?: HuntressIncidentStatus;
    platform?: string | null;
    indicator_types?: string[];
    indicator_counts?: Record<string, number>;
    psa_ticket_eids?: string[];
    remediations?: Array<Partial<HuntressRemediationRecord> & { type: string }>;
    sent_at?: string | null;
    closed_at?: string | null;
    created_at?: string;
    updated_at?: string;
  }): HuntressIncidentRecord {
    const id = input.id ?? this.nextId('incident');
    if (this.incidents.has(id)) throw new HuntressWireError(409, `Incident report ${id} already exists`);
    if (input.id !== undefined) this.counters.incident = Math.max(this.counters.incident, input.id);
    const now = this.nowIso();
    const status = input.status ?? 'sent';
    const severity = input.severity ?? 'low';
    const indicatorTypes = input.indicator_types ?? ['footholds'];
    const incident: HuntressIncidentRecord = {
      id,
      account_id: this.config.account.id,
      agent_id: input.agent_id ?? null,
      organization_id: input.organization_id ?? null,
      subject: input.subject ?? null,
      summary: input.summary ?? null,
      body: input.body ?? null,
      severity,
      status,
      platform: input.platform ?? 'windows',
      indicator_types: indicatorTypes,
      indicator_counts:
        input.indicator_counts ?? Object.fromEntries(indicatorTypes.map((type) => [type, 1])),
      psa_ticket_eids: input.psa_ticket_eids ?? [],
      remediations: (input.remediations ?? []).map((remediation) => ({
        id: remediation.id ?? this.nextId('remediation'),
        type: remediation.type,
        action: remediation.action ?? null,
        status: remediation.status ?? null,
        parameters: remediation.parameters ?? [],
        approved_at: remediation.approved_at ?? null,
        approved_by: remediation.approved_by ?? null,
        completed_at: remediation.completed_at ?? null,
      })),
      // A seeded history keeps its own timeline: a report backdated with
      // created_at/updated_at must not claim it was sent or touched now.
      sent_at: input.sent_at ?? (status === 'sent' ? input.created_at ?? now : null),
      closed_at: input.closed_at ?? (status === 'closed' ? input.updated_at ?? now : null),
      status_updated_at: input.updated_at ?? now,
      created_at: input.created_at ?? now,
      updated_at: input.updated_at ?? now,
    };
    this.incidents.set(id, incident);
    return incident;
  }

  getIncident(id: number): HuntressIncidentRecord {
    const incident = this.incidents.get(id);
    if (!incident) throw new HuntressWireError(404, HUNTRESS_NOT_FOUND_ERROR);
    return incident;
  }

  /**
   * A SOC status change. Huntress documents the statuses but no transition
   * graph, so any documented status is accepted; `closed` stamps `closed_at`
   * and every status change stamps `status_updated_at`.
   */
  updateIncident(
    id: number,
    patch: {
      status?: HuntressIncidentStatus;
      severity?: HuntressSeverity;
      subject?: string | null;
      summary?: string | null;
      body?: string | null;
      psa_ticket_eids?: string[];
    },
  ): HuntressIncidentRecord {
    const incident = this.getIncident(id);
    const now = this.nowIso();
    if (patch.status !== undefined && patch.status !== incident.status) {
      if (!HUNTRESS_INCIDENT_STATUSES.includes(patch.status)) {
        throw new HuntressWireError(400, `Bad Request: unknown incident status "${patch.status}"`);
      }
      incident.status = patch.status;
      incident.status_updated_at = now;
      incident.closed_at = patch.status === 'closed' ? now : null;
      if (patch.status === 'sent' && !incident.sent_at) incident.sent_at = now;
    }
    if (patch.severity !== undefined) incident.severity = patch.severity;
    if (patch.subject !== undefined) incident.subject = patch.subject;
    if (patch.summary !== undefined) incident.summary = patch.summary;
    if (patch.body !== undefined) incident.body = patch.body;
    if (patch.psa_ticket_eids !== undefined) incident.psa_ticket_eids = [...patch.psa_ticket_eids];
    incident.updated_at = now;
    return incident;
  }

  /** Huntress re-touches a report without changing its status. */
  touchIncident(id: number): HuntressIncidentRecord {
    const incident = this.getIncident(id);
    incident.updated_at = this.nowIso();
    return incident;
  }

  /** `remediations` carries the first 10 items plus the total (documented). */
  presentIncident(incident: HuntressIncidentRecord): Record<string, unknown> {
    const { remediations, ...fields } = structuredClone(incident);
    return {
      ...fields,
      remediations: {
        total_count: remediations.length,
        has_more: remediations.length > 10,
        items: remediations.slice(0, 10),
      },
    };
  }

  // ── Escalations ─────────────────────────────────────────────────────────

  createEscalation(input: {
    id?: number;
    organization_ids?: number[];
    severity?: HuntressSeverity;
    status?: HuntressEscalationStatus;
    subject?: string;
    type?: string;
    type_code?: string;
    subtype?: string | null;
    psa_ticket_eids?: string[];
    entities?: Array<{ id?: number; type: 'Agent' | 'Identity'; details?: Record<string, unknown> }>;
    due_at?: string | null;
    api_resolvable?: boolean;
    created_at?: string;
    updated_at?: string;
  }): HuntressEscalationRecord {
    const id = input.id ?? this.nextId('escalation');
    if (this.escalations.has(id)) throw new HuntressWireError(409, `Escalation ${id} already exists`);
    if (input.id !== undefined) this.counters.escalation = Math.max(this.counters.escalation, input.id);
    const now = this.nowIso();
    const status = input.status ?? 'open';
    const escalation: HuntressEscalationRecord = {
      id,
      organization_ids: [...(input.organization_ids ?? [])],
      severity: input.severity ?? 'low',
      status,
      subject: input.subject ?? 'Environmental Issue',
      type: input.type ?? 'Environmental Issue',
      type_code: input.type_code ?? 'environmental_issue',
      subtype: input.subtype ?? null,
      psa_ticket_eids: input.psa_ticket_eids ?? [],
      entities: (input.entities ?? []).map((entity) => this.buildEntity(entity)),
      created_at: input.created_at ?? now,
      resolved_at: status === 'resolved' ? now : null,
      updated_at: input.updated_at ?? now,
      internal: { due_at: input.due_at ?? null, api_resolvable: input.api_resolvable ?? true },
    };
    this.escalations.set(id, escalation);
    return escalation;
  }

  private buildEntity(entity: { id?: number; type: 'Agent' | 'Identity'; details?: Record<string, unknown> }): HuntressEscalationEntity {
    const id = entity.id ?? this.nextId('entity');
    if (entity.details) return { id, type: entity.type, details: { ...entity.details } };
    // An Agent entity's documented details mirror the agent record.
    const agent = entity.type === 'Agent' ? this.agents.get(id) : undefined;
    return {
      id,
      type: entity.type,
      details: agent
        ? {
            hostname: agent.hostname,
            platform: agent.platform,
            os: agent.os,
            last_callback_at: agent.last_callback_at,
          }
        : {},
    };
  }

  getEscalation(id: number): HuntressEscalationRecord {
    const escalation = this.escalations.get(id);
    if (!escalation) throw new HuntressWireError(404, HUNTRESS_NOT_FOUND_ERROR);
    return escalation;
  }

  updateEscalation(
    id: number,
    patch: {
      status?: HuntressEscalationStatus;
      severity?: HuntressSeverity;
      subject?: string;
      type?: string;
      type_code?: string;
      subtype?: string | null;
      psa_ticket_eids?: string[];
      organization_ids?: number[];
      addOrganizationIds?: number[];
      removeOrganizationIds?: number[];
      entities?: Array<{ id?: number; type: 'Agent' | 'Identity'; details?: Record<string, unknown> }>;
      due_at?: string | null;
    },
  ): HuntressEscalationRecord {
    const escalation = this.getEscalation(id);
    const now = this.nowIso();
    if (patch.status !== undefined && patch.status !== escalation.status) {
      if (!HUNTRESS_ESCALATION_STATUSES.includes(patch.status)) {
        throw new HuntressWireError(400, `Bad Request: unknown escalation status "${patch.status}"`);
      }
      escalation.status = patch.status;
      escalation.resolved_at = patch.status === 'resolved' ? now : null;
    }
    if (patch.severity !== undefined) escalation.severity = patch.severity;
    if (patch.subject !== undefined) escalation.subject = patch.subject;
    if (patch.type !== undefined) escalation.type = patch.type;
    if (patch.type_code !== undefined) escalation.type_code = patch.type_code;
    if (patch.subtype !== undefined) escalation.subtype = patch.subtype;
    if (patch.psa_ticket_eids !== undefined) escalation.psa_ticket_eids = [...patch.psa_ticket_eids];
    if (patch.organization_ids !== undefined) escalation.organization_ids = [...patch.organization_ids];
    for (const organizationId of patch.addOrganizationIds ?? []) {
      if (!escalation.organization_ids.includes(organizationId)) escalation.organization_ids.push(organizationId);
    }
    if (patch.removeOrganizationIds?.length) {
      escalation.organization_ids = escalation.organization_ids.filter(
        (organizationId) => !patch.removeOrganizationIds!.includes(organizationId),
      );
    }
    if (patch.entities !== undefined) escalation.entities = patch.entities.map((entity) => this.buildEntity(entity));
    if (patch.due_at !== undefined) escalation.internal.due_at = patch.due_at;
    escalation.updated_at = now;
    return escalation;
  }

  /**
   * POST /v1/escalations/{id}/resolution. The documented failures: 403 for a
   * read-only credential, 409 when already resolved, 422 when the escalation
   * cannot be resolved through the API, 400 for invalid parameters.
   * `determination`/`scope` apply only to Unwanted Access escalations; both
   * omitted there is the portal's "dismiss".
   */
  resolveEscalation(
    id: number,
    params: HuntressResolutionParameters,
    credential: { escalationsWrite: boolean },
  ): { escalation: HuntressEscalationRecord; resolution_method: HuntressResolutionMethod } {
    const escalation = this.getEscalation(id);
    if (!credential.escalationsWrite) throw new HuntressWireError(403, HUNTRESS_CREDENTIAL_ERROR);
    if (escalation.status === 'resolved') {
      throw new HuntressWireError(409, 'Escalation has already been resolved');
    }
    if (!escalation.internal.api_resolvable) {
      throw new HuntressWireError(422, 'Escalation cannot be resolved through the API');
    }

    const bad = (detail: string) => new HuntressWireError(400, `Invalid resolution parameters: ${detail}`);
    const { determination, scope, expiration_date: expirationDate, ip_address: ipAddress } = params;
    const revoke = params.revoke_and_disable_identities;
    if (determination !== undefined && !HUNTRESS_DETERMINATIONS.includes(determination)) {
      throw bad(`determination must be one of ${HUNTRESS_DETERMINATIONS.join(', ')}`);
    }
    if (scope !== undefined && !HUNTRESS_RESOLUTION_SCOPES.includes(scope)) {
      throw bad(`scope must be one of ${HUNTRESS_RESOLUTION_SCOPES.join(', ')}`);
    }

    const unwantedAccess = (HUNTRESS_UNWANTED_ACCESS_TYPE_CODES as readonly string[]).includes(escalation.type_code);
    if (!unwantedAccess && (determination !== undefined || scope !== undefined)) {
      throw bad(`${escalation.type_code} escalations do not accept determination or scope`);
    }
    if (unwantedAccess && (determination === undefined) !== (scope === undefined)) {
      throw bad('determination and scope must be supplied together');
    }
    if (revoke !== undefined && determination !== 'unauthorized') {
      throw bad('revoke_and_disable_identities requires determination=unauthorized');
    }
    if (expirationDate !== undefined && determination !== 'expected') {
      throw bad('expiration_date requires determination=expected');
    }
    if (ipAddress !== undefined) {
      if (determination !== 'expected') throw bad('ip_address requires determination=expected');
      const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(ipAddress) && ipAddress.split('.').every((part) => Number(part) <= 255);
      const ipv6 = /^[0-9a-f:]+$/i.test(ipAddress) && ipAddress.includes(':');
      if (!ipv4 && !ipv6) throw bad('ip_address must be a valid IPv4 or IPv6 address');
    }

    const now = this.nowIso();
    escalation.status = 'resolved';
    escalation.resolved_at = now;
    escalation.updated_at = now;
    const resolutionMethod: HuntressResolutionMethod = !unwantedAccess
      ? 'direct'
      : determination !== undefined
        ? 'rule'
        : 'dismiss';
    return { escalation, resolution_method: resolutionMethod };
  }

  presentEscalation(
    escalation: HuntressEscalationRecord,
    options: { withEntities: boolean },
  ): PresentedEscalation {
    const presented: PresentedEscalation = {
      id: escalation.id,
      account: { id: this.config.account.id, name: this.config.account.name },
      organizations: escalation.organization_ids.map((organizationId) => ({
        id: organizationId,
        name: this.organizations.get(organizationId)?.name ?? `Huntress org ${organizationId}`,
      })),
      created_at: escalation.created_at,
      resolved_at: escalation.resolved_at,
      severity: escalation.severity,
      status: escalation.status,
      subject: escalation.subject,
      subtype: escalation.subtype,
      type: escalation.type,
      type_code: escalation.type_code,
      psa_ticket_eids: [...escalation.psa_ticket_eids],
      updated_at: escalation.updated_at,
    };
    if (options.withEntities) {
      presented.entities = {
        total_count: escalation.entities.length,
        has_more: escalation.entities.length > 10,
        items: structuredClone(escalation.entities).slice(0, 10),
      };
    }
    return presented;
  }

  // ── Pagination and sorting ──────────────────────────────────────────────

  /**
   * Documented list semantics: `limit` 1–500 (default 10), opaque `page_token`
   * cursor, `sort_field` per resource, `sort_direction` asc/desc (default
   * desc). An out-of-range limit is clamped; ties break on `id` so pages never
   * overlap or skip.
   */
  paginate<T extends { id: number }>(
    items: T[],
    query: Record<string, unknown>,
    resource: HuntressResource,
  ): PaginatedPage<T> {
    const limit = parseLimit(query.limit);
    const field = this.sortField(query.sort_field, resource);
    const direction = sortDirection(query.sort_direction);
    const sign = direction === 'asc' ? 1 : -1;
    const keyed = items.map((item) => ({ item, key: this.sortKey(item, field) }));
    keyed.sort((a, b) => sign * compareKeys(a.key, b.key));

    let start = 0;
    const token = typeof query.page_token === 'string' && query.page_token ? query.page_token : null;
    if (token) {
      const cursor = decodeCursor(token, numericSortField(field));
      const index = keyed.findIndex((entry) => sign * compareKeys(entry.key, cursor) > 0);
      start = index < 0 ? keyed.length : index;
    }
    const page = keyed.slice(start, start + limit);
    const hasMore = start + limit < keyed.length;
    return {
      items: page.map((entry) => entry.item),
      nextPageToken: hasMore && page.length > 0 ? encodeCursor(page[page.length - 1].key) : null,
      limit,
    };
  }

  private sortField(raw: unknown, resource: HuntressResource): string {
    const allowed = HUNTRESS_SORT_FIELDS[resource] as readonly string[];
    if (raw === undefined || raw === '') return 'id';
    const field = String(raw);
    if (!allowed.includes(field)) {
      throw new HuntressWireError(400, `Bad Request: sort_field must be one of ${allowed.join(', ')}`);
    }
    return field;
  }

  private sortKey(item: { id: number }, field: string): SortKey {
    const record = item as Record<string, unknown>;
    if (field === 'id') return { primary: item.id, id: item.id };
    if (field === 'severity') {
      const severity = record.severity as HuntressSeverity | undefined;
      return { primary: severity ? SEVERITY_RANK[severity] : -1, id: item.id };
    }
    if (field === 'due_at') {
      const internal = record.internal as { due_at?: string | null } | undefined;
      return { primary: internal?.due_at ?? '', id: item.id };
    }
    const value = record[field];
    return { primary: typeof value === 'string' ? value : '', id: item.id };
  }
}

function parseLimit(raw: unknown): number {
  if (raw === undefined || raw === '') return 10;
  const limit = Number(raw);
  if (!Number.isFinite(limit)) return 10;
  return Math.min(500, Math.max(1, Math.trunc(limit)));
}

function sortDirection(raw: unknown): 'asc' | 'desc' {
  if (raw === undefined || raw === '') return 'desc';
  const direction = String(raw);
  if (direction !== 'asc' && direction !== 'desc') {
    throw new HuntressWireError(400, 'Bad Request: sort_direction must be one of asc, desc');
  }
  return direction;
}

function numericSortField(field: string): boolean {
  return field === 'id' || field === 'severity';
}
