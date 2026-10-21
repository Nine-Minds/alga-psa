import type { EmulatorCore, HostEnv } from '@alga-psa/emulator-host';

/**
 * Level-shaped error the wire shell serializes. Level's documented error
 * envelope is a bare `{ "error": "<message>" }` (e.g. 401 "Access denied",
 * 404 "Record not found").
 */
export class LevelWireError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly headers: Record<string, string> = {},
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'LevelWireError';
  }

  toEnvelope(): { error: string; code?: string } {
    return { error: this.message, ...(this.code ? { code: this.code } : {}) };
  }
}

// ── Vendor resources (shapes from the Level v2 OpenAPI definition) ─────────

export const LEVEL_EVENT_TYPES = [
  'alert_active',
  'alert_resolved',
  'device_created',
  'device_updated',
  'device_deleted',
  'group_created',
  'group_updated',
  'group_deleted',
] as const;
export type LevelEventType = (typeof LEVEL_EVENT_TYPES)[number];

export const LEVEL_SEVERITIES = ['information', 'warning', 'critical', 'emergency'] as const;
export type LevelSeverity = (typeof LEVEL_SEVERITIES)[number];

export interface LevelGroupRecord {
  id: string;
  parent_id: string | null;
  name: string;
}

export interface LevelGroup extends LevelGroupRecord {
  child_ids: string[];
  device_count: number;
  descendent_device_count: number;
}

/**
 * Detail sections Level returns only when the matching `include_*` query
 * parameter is `true`.
 */
export const DEVICE_DETAIL_SECTIONS = {
  include_operating_system: 'operating_system',
  include_cpus: 'cpus',
  include_memory: 'memory',
  include_disks: 'disks',
  include_network_interfaces: 'network_interfaces',
  include_motherboard: 'motherboard',
  include_security: 'security',
} as const;

export interface LevelDevice {
  id: string;
  hostname: string;
  nickname: string | null;
  role: 'workstation' | 'server' | 'domain_controller' | null;
  group_id: string | null;
  tags: string[];
  flag: string | null;
  maintenance_mode: boolean;
  online: boolean;
  notes: string | null;
  manufacturer: string | null;
  model: string | null;
  architecture: string | null;
  serial_number: string | null;
  total_memory: number | null;
  memory_slots: number | null;
  cpu_cores: number | null;
  last_logged_in_user: string | null;
  last_reboot_time: string | null;
  last_seen_at: string | null;
  city: string | null;
  country: string | null;
  security_score: number | null;
  platform: 'Windows' | 'Mac' | 'Linux' | null;
  operating_system?: Record<string, unknown>;
  cpus?: Array<Record<string, unknown>>;
  memory?: Array<Record<string, unknown>>;
  disks?: Array<Record<string, unknown>>;
  network_interfaces?: Array<Record<string, unknown>>;
  motherboard?: Record<string, unknown>;
  security?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Device facts that only surface through automation system variables
 * (`level_device_public_ip_address`, `level_device_first_seen_at`,
 * `level_device_restart_required`), not through the REST device schema.
 */
export interface LevelDeviceFacts {
  publicIpAddress: string | null;
  firstSeenAt: string;
  restartRequired: boolean;
}

export interface LevelAlert {
  id: string;
  device_id: string;
  device_hostname: string;
  name: string;
  description: string;
  payload: string | null;
  severity: LevelSeverity;
  is_resolved: boolean;
  started_at: string;
  resolved_at: string | null;
}

export interface LevelUpdate {
  id: string;
  device_id: string;
  device_hostname: string;
  name: string;
  description: string | null;
  category: string;
  version: string | null;
  size: number;
  kb_ids: string[];
  is_available: boolean;
  error: string | null;
  published_on: string | null;
  installed_on: string | null;
}

// ── Native webhooks (Settings → Webhooks) ─────────────────────────────────

export interface LevelWebhookEndpoint {
  id: string;
  url: string;
  /** Null = no secret configured, so deliveries carry no X-Level-Signature. */
  secret: string | null;
  eventTypes: LevelEventType[];
  enabled: boolean;
}

export interface LevelWebhookEvent {
  event_type: LevelEventType;
  event_id: string;
  occurred_at: string;
  data: Record<string, unknown>;
}

export type DeliveryTrigger = 'initial' | 'retry' | 'rerun';

export interface WebhookDeliveryRecord {
  id: number;
  webhookId: string;
  eventId: string;
  eventType: LevelEventType;
  trigger: DeliveryTrigger;
  /** 1 for the first send; automatic retries count up from there. */
  attempt: number;
  url: string;
  signature: string | null;
  status: number;
  ok: boolean;
  response: string;
  error?: string;
  deliveredAt: string;
  nextRetryAt: string | null;
}

export interface PendingRetry {
  webhookId: string;
  eventId: string;
  attempt: number;
  dueAtMs: number;
}

// ── Automations: monitor remediation → HTTP Request action ────────────────

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];
export const HTTP_CONTENT_TYPES = ['application/json', 'text/plain', 'application/x-www-form-urlencoded'] as const;
export type HttpContentType = (typeof HTTP_CONTENT_TYPES)[number];

export interface HttpRequestAction {
  url: string;
  method: HttpMethod;
  contentType: HttpContentType;
  headers: Array<{ key: string; value: string }>;
  body: string;
}

export interface LevelAutomation {
  id: string;
  name: string;
  enabled: boolean;
  /** Monitor trigger: fires when a matching alert becomes active. */
  trigger: {
    type: 'monitor';
    /** Alert names this monitor raises; empty = every alert. */
    alertNames: string[];
    /** Limit to devices in these groups (or their descendants); empty = all. */
    groupIds: string[];
  };
  action: HttpRequestAction;
  /** Automation variables available to `{{name}}` alongside system variables. */
  variables: Record<string, string>;
  /** Extra attempts after a failed (non-2xx / network) action. */
  retries: number;
}

export interface AutomationRunRecord {
  id: number;
  automationId: string;
  alertId: string | null;
  deviceId: string;
  attempt: number;
  request: { method: HttpMethod; url: string; headers: Record<string, string>; body: string };
  /** `{{tokens}}` that matched no variable and were sent literally. */
  unresolvedVariables: string[];
  status: number;
  ok: boolean;
  response: string;
  error?: string;
  ranAt: string;
}

export interface OperationFault {
  /** "GET /v2/devices", or "*" for every vendor operation. */
  operation: string;
  status: number;
  message: string;
  retryAfterSeconds: number | null;
  remaining: number;
}

export interface LevelConfig {
  apiKeys: string[];
  /** Automatic webhook retries after the first failed attempt. */
  webhookMaxRetries: number;
  /** First retry delay; doubles per attempt, plus up to `retryJitterMs`. */
  retryBaseDelayMs: number;
  retryJitterMs: number;
  /** Background delivery of due retries as wall/virtual time passes. */
  autoRetry: boolean;
}

export interface ListPage<T> {
  data: T[];
  has_more: boolean;
}

const DEFAULT_API_KEY = 'algasim-level-key';

function defaultConfig(): LevelConfig {
  return {
    apiKeys: [DEFAULT_API_KEY],
    // Level: "Failed deliveries are automatically retried up to 3 times" with
    // "exponential backoff with jitter (2+ minutes between attempts)".
    webhookMaxRetries: 3,
    retryBaseDelayMs: 2 * 60_000,
    retryJitterMs: 30_000,
    autoRetry: true,
  };
}

/** Level ids are unpadded base64 of a GraphQL global id, e.g. gid://level/Device/1. */
export function levelGid(type: string, n: number): string {
  return Buffer.from(`gid://level/${type}/${n}`, 'utf8').toString('base64').replace(/=+$/, '');
}

interface Counters {
  group: number;
  device: number;
  alert: number;
  update: number;
  tag: number;
  webhook: number;
  automation: number;
  delivery: number;
  run: number;
}

function zeroCounters(): Counters {
  return { group: 0, device: 0, alert: 0, update: 0, tag: 0, webhook: 0, automation: 0, delivery: 0, run: 0 };
}

export interface LevelSnapshot {
  config: LevelConfig;
  groups: LevelGroupRecord[];
  devices: LevelDevice[];
  deviceFacts: Array<[string, LevelDeviceFacts]>;
  alerts: LevelAlert[];
  alertWebhookExtras: Array<[string, Record<string, unknown>]>;
  updates: LevelUpdate[];
  tags: Array<[string, string]>;
  webhooks: LevelWebhookEndpoint[];
  automations: LevelAutomation[];
  counters: Counters;
}

/**
 * Deterministic Level-shaped state machine. No I/O, no wall time
 * (`env.clock`), no `Math.random()` (`env.rng`). The wire shell adapts these
 * operations to Level's v2 REST surface; the dispatcher performs outbound
 * webhook and automation HTTP.
 */
export class LevelEmulatorCore implements EmulatorCore {
  readonly env: HostEnv;
  config: LevelConfig = defaultConfig();

  /** Insertion order is list order, which is what cursor pagination walks. */
  readonly groups = new Map<string, LevelGroupRecord>();
  readonly devices = new Map<string, LevelDevice>();
  readonly deviceFacts = new Map<string, LevelDeviceFacts>();
  readonly alerts = new Map<string, LevelAlert>();
  /** Per-alert extra fields merged into webhook `data` (unverified shape). */
  readonly alertWebhookExtras = new Map<string, Record<string, unknown>>();
  readonly updates = new Map<string, LevelUpdate>();
  /** Tag name → tag id. */
  readonly tags = new Map<string, string>();

  readonly webhooks = new Map<string, LevelWebhookEndpoint>();
  readonly events = new Map<string, LevelWebhookEvent>();
  readonly deliveries: WebhookDeliveryRecord[] = [];
  pendingRetries: PendingRetry[] = [];

  readonly automations = new Map<string, LevelAutomation>();
  readonly automationRuns: AutomationRunRecord[] = [];

  readonly operationFaults: OperationFault[] = [];

  private counters: Counters = zeroCounters();

  constructor(env: HostEnv) {
    this.env = env;
  }

  reset(): void {
    this.config = defaultConfig();
    this.groups.clear();
    this.devices.clear();
    this.deviceFacts.clear();
    this.alerts.clear();
    this.alertWebhookExtras.clear();
    this.updates.clear();
    this.tags.clear();
    this.webhooks.clear();
    this.events.clear();
    this.deliveries.length = 0;
    this.pendingRetries = [];
    this.automations.clear();
    this.automationRuns.length = 0;
    this.operationFaults.length = 0;
    this.counters = zeroCounters();
  }

  snapshot(): LevelSnapshot {
    return structuredClone({
      config: this.config,
      groups: [...this.groups.values()],
      devices: [...this.devices.values()],
      deviceFacts: [...this.deviceFacts.entries()],
      alerts: [...this.alerts.values()],
      alertWebhookExtras: [...this.alertWebhookExtras.entries()],
      updates: [...this.updates.values()],
      tags: [...this.tags.entries()],
      webhooks: [...this.webhooks.values()],
      automations: [...this.automations.values()],
      counters: this.counters,
    });
  }

  restore(state: unknown): void {
    const snap = structuredClone(state) as LevelSnapshot;
    this.reset();
    this.config = { ...defaultConfig(), ...snap.config };
    for (const group of snap.groups ?? []) this.groups.set(group.id, group);
    for (const device of snap.devices ?? []) this.devices.set(device.id, device);
    for (const [id, facts] of snap.deviceFacts ?? []) this.deviceFacts.set(id, facts);
    for (const alert of snap.alerts ?? []) this.alerts.set(alert.id, alert);
    for (const [id, extra] of snap.alertWebhookExtras ?? []) this.alertWebhookExtras.set(id, extra);
    for (const update of snap.updates ?? []) this.updates.set(update.id, update);
    for (const [name, id] of snap.tags ?? []) this.tags.set(name, id);
    for (const webhook of snap.webhooks ?? []) this.webhooks.set(webhook.id, webhook);
    for (const automation of snap.automations ?? []) this.automations.set(automation.id, automation);
    this.counters = { ...zeroCounters(), ...snap.counters };
  }

  now(): Date {
    return this.env.clock.now();
  }

  private nextId(kind: keyof Counters, type: string): string {
    this.counters[kind] += 1;
    return levelGid(type, this.counters[kind]);
  }

  /** RFC 4122 v4 UUID from the seeded PRNG, so event ids replay. */
  uuid(): string {
    const bytes = Array.from({ length: 16 }, () => Math.floor(this.env.rng() * 256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  configure(patch: Partial<LevelConfig>): LevelConfig {
    this.config = { ...this.config, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    return this.config;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  /**
   * Level's security scheme is an apiKey in the `Authorization` header: the
   * raw key, no scheme prefix. A `Bearer <key>` value is not the documented
   * form and is rejected rather than silently accepted.
   */
  authenticate(authorization: string | undefined): void {
    const key = (authorization ?? '').trim();
    if (!key || !this.config.apiKeys.includes(key)) {
      throw new LevelWireError(401, 'Access denied');
    }
  }

  // ── Operation faults ──────────────────────────────────────────────────────

  armOperationFault(fault: OperationFault): void {
    this.operationFaults.push({ ...fault });
  }

  disarmOperationFaults(): void {
    this.operationFaults.length = 0;
  }

  /** Consumes one use of the first fault matching the operation. */
  consumeOperationFault(operation: string): OperationFault | null {
    const index = this.operationFaults.findIndex((f) => f.operation === '*' || f.operation === operation);
    if (index < 0) return null;
    const fault = this.operationFaults[index];
    fault.remaining -= 1;
    if (fault.remaining <= 0) this.operationFaults.splice(index, 1);
    return { ...fault };
  }

  // ── Groups ────────────────────────────────────────────────────────────────

  private childIds(groupId: string): string[] {
    return [...this.groups.values()].filter((g) => g.parent_id === groupId).map((g) => g.id);
  }

  /** The group and every group below it. */
  descendantGroupIds(groupId: string): Set<string> {
    const ids = new Set<string>([groupId]);
    const queue = [groupId];
    while (queue.length) {
      for (const child of this.childIds(queue.shift()!)) {
        if (!ids.has(child)) {
          ids.add(child);
          queue.push(child);
        }
      }
    }
    return ids;
  }

  presentGroup(record: LevelGroupRecord): LevelGroup {
    const descendants = this.descendantGroupIds(record.id);
    const devices = [...this.devices.values()];
    return {
      id: record.id,
      parent_id: record.parent_id,
      child_ids: this.childIds(record.id),
      name: record.name,
      device_count: devices.filter((d) => d.group_id === record.id).length,
      descendent_device_count: devices.filter((d) => d.group_id && descendants.has(d.group_id)).length,
    };
  }

  getGroup(id: string): LevelGroupRecord {
    const group = this.groups.get(id);
    if (!group) throw new LevelWireError(404, 'Record not found');
    return group;
  }

  createGroup(input: { id?: string; name: string; parentId?: string | null }): LevelGroupRecord {
    if (input.parentId) this.getGroup(input.parentId);
    const id = input.id ?? this.nextId('group', 'DeviceGroup');
    if (this.groups.has(id)) throw new LevelWireError(409, `Group ${id} already exists`);
    const group: LevelGroupRecord = { id, name: input.name, parent_id: input.parentId ?? null };
    this.groups.set(id, group);
    return group;
  }

  updateGroup(id: string, patch: { name?: string; parentId?: string | null }): LevelGroupRecord {
    const group = this.getGroup(id);
    if (patch.parentId !== undefined) {
      if (patch.parentId && this.descendantGroupIds(id).has(patch.parentId)) {
        throw new LevelWireError(422, 'A group cannot be moved beneath itself');
      }
      if (patch.parentId) this.getGroup(patch.parentId);
      group.parent_id = patch.parentId;
    }
    if (patch.name !== undefined) group.name = patch.name;
    return group;
  }

  /** Deletes the group; its children move up to its parent, its devices become ungrouped. */
  deleteGroup(id: string): LevelGroup {
    const group = this.getGroup(id);
    const presented = this.presentGroup(group);
    for (const child of this.groups.values()) {
      if (child.parent_id === id) child.parent_id = group.parent_id;
    }
    for (const device of this.devices.values()) {
      if (device.group_id === id) device.group_id = null;
    }
    this.groups.delete(id);
    return presented;
  }

  /** "HQ / Servers" — root first, as `level_group_path` renders it. */
  groupPath(groupId: string | null): string {
    const names: string[] = [];
    let cursor = groupId ? this.groups.get(groupId) : undefined;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      names.unshift(cursor.name);
      cursor = cursor.parent_id ? this.groups.get(cursor.parent_id) : undefined;
    }
    return names.join(' / ');
  }

  // ── Devices ───────────────────────────────────────────────────────────────

  tagId(name: string): string {
    let id = this.tags.get(name);
    if (!id) {
      id = this.nextId('tag', 'Tag');
      this.tags.set(name, id);
    }
    return id;
  }

  getDevice(id: string): LevelDevice {
    const device = this.devices.get(id);
    if (!device) throw new LevelWireError(404, 'Record not found');
    return device;
  }

  createDevice(input: Partial<LevelDevice> & { hostname: string } & {
    publicIpAddress?: string | null;
    restartRequired?: boolean;
  }): LevelDevice {
    const { publicIpAddress, restartRequired, ...fields } = input;
    if (fields.group_id) this.getGroup(fields.group_id);
    const id = fields.id ?? this.nextId('device', 'Device');
    if (this.devices.has(id)) throw new LevelWireError(409, `Device ${id} already exists`);
    const now = this.now().toISOString();
    const device: LevelDevice = {
      nickname: null,
      role: 'workstation',
      group_id: null,
      tags: [],
      flag: null,
      maintenance_mode: false,
      online: true,
      notes: null,
      manufacturer: null,
      model: null,
      architecture: null,
      serial_number: null,
      total_memory: null,
      memory_slots: null,
      cpu_cores: null,
      last_logged_in_user: null,
      last_reboot_time: null,
      last_seen_at: now,
      city: null,
      country: null,
      security_score: null,
      platform: 'Windows',
      ...fields,
      id,
      hostname: fields.hostname,
    };
    for (const tag of device.tags) this.tagId(tag);
    this.devices.set(id, device);
    this.deviceFacts.set(id, {
      publicIpAddress: publicIpAddress ?? null,
      firstSeenAt: now,
      restartRequired: restartRequired ?? false,
    });
    return device;
  }

  updateDevice(id: string, patch: Partial<LevelDevice> & { publicIpAddress?: string | null; restartRequired?: boolean }): LevelDevice {
    const device = this.getDevice(id);
    const { publicIpAddress, restartRequired, id: _ignored, ...fields } = patch;
    if (fields.group_id) this.getGroup(fields.group_id);
    Object.assign(device, fields);
    for (const tag of device.tags) this.tagId(tag);
    const facts = this.deviceFacts.get(id)!;
    if (publicIpAddress !== undefined) facts.publicIpAddress = publicIpAddress;
    if (restartRequired !== undefined) facts.restartRequired = restartRequired;
    return device;
  }

  deleteDevice(id: string): LevelDevice {
    const device = this.getDevice(id);
    this.devices.delete(id);
    this.deviceFacts.delete(id);
    return device;
  }

  /** The agent reports in: online, and last seen now. */
  checkIn(id: string): LevelDevice {
    const device = this.getDevice(id);
    device.online = true;
    device.last_seen_at = this.now().toISOString();
    return device;
  }

  /** The agent stops reporting: last_seen_at freezes at this moment. */
  goOffline(id: string): LevelDevice {
    const device = this.getDevice(id);
    if (device.online) device.last_seen_at = this.now().toISOString();
    device.online = false;
    return device;
  }

  /**
   * The device as the API returns it. `last_seen_at` "Returns the current
   * time if the device is online", and detail sections appear only when their
   * include flag is set (pass `null` for every section, as webhooks carry).
   */
  presentDevice(device: LevelDevice, include: Record<string, unknown> | null): LevelDevice {
    const out: LevelDevice = structuredClone(device);
    if (out.online) out.last_seen_at = this.now().toISOString();
    if (include) {
      for (const [flag, section] of Object.entries(DEVICE_DETAIL_SECTIONS)) {
        if (String(include[flag]) !== 'true') delete out[section];
      }
    }
    return out;
  }

  // ── Alerts ────────────────────────────────────────────────────────────────

  getAlert(id: string): LevelAlert {
    const alert = this.alerts.get(id);
    if (!alert) throw new LevelWireError(404, 'Record not found');
    return alert;
  }

  raiseAlert(input: {
    deviceId: string;
    name: string;
    description?: string;
    payload?: string | null;
    severity?: LevelSeverity;
    id?: string;
    webhookDataExtra?: Record<string, unknown>;
  }): LevelAlert {
    const device = this.getDevice(input.deviceId);
    const id = input.id ?? this.nextId('alert', 'Alert');
    if (this.alerts.has(id)) throw new LevelWireError(409, `Alert ${id} already exists`);
    const alert: LevelAlert = {
      id,
      device_id: device.id,
      device_hostname: device.hostname,
      name: input.name,
      description: input.description ?? '',
      payload: input.payload ?? null,
      severity: input.severity ?? 'warning',
      is_resolved: false,
      started_at: this.now().toISOString(),
      resolved_at: null,
    };
    this.alerts.set(id, alert);
    if (input.webhookDataExtra) this.alertWebhookExtras.set(id, input.webhookDataExtra);
    return alert;
  }

  /** Returns the alert and whether this call changed it (re-resolving is a no-op). */
  resolveAlert(id: string): { alert: LevelAlert; changed: boolean } {
    const alert = this.getAlert(id);
    if (alert.is_resolved) return { alert, changed: false };
    alert.is_resolved = true;
    alert.resolved_at = this.now().toISOString();
    return { alert, changed: true };
  }

  // ── Updates ───────────────────────────────────────────────────────────────

  createUpdate(input: Partial<LevelUpdate> & { deviceId: string; name: string }): LevelUpdate {
    const device = this.getDevice(input.deviceId);
    const { deviceId: _deviceId, ...fields } = input;
    const update: LevelUpdate = {
      description: null,
      category: 'Security Updates',
      version: null,
      size: 0,
      kb_ids: [],
      is_available: true,
      error: null,
      published_on: null,
      installed_on: null,
      ...fields,
      id: fields.id ?? this.nextId('update', 'Update'),
      device_id: device.id,
      device_hostname: device.hostname,
      name: input.name,
    };
    this.updates.set(update.id, update);
    return update;
  }

  getUpdate(id: string): LevelUpdate {
    const update = this.updates.get(id);
    if (!update) throw new LevelWireError(404, 'Record not found');
    return update;
  }

  // ── Cursor pagination ─────────────────────────────────────────────────────

  /**
   * Level list semantics: `limit` 1–100 (default 20), `starting_after` /
   * `ending_before` item-id cursors, `{ data, has_more }`. An out-of-range
   * limit or an unknown cursor is rejected; Level does not document the
   * rejection envelope, so the 400 here is an emulator choice.
   */
  paginate<T extends { id: string }>(items: T[], query: Record<string, unknown>): ListPage<T> {
    const rawLimit = query.limit;
    let limit = 20;
    if (rawLimit !== undefined && rawLimit !== '') {
      limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new LevelWireError(400, 'limit must be an integer between 1 and 100');
      }
    }
    const startingAfter = typeof query.starting_after === 'string' && query.starting_after ? query.starting_after : null;
    const endingBefore = typeof query.ending_before === 'string' && query.ending_before ? query.ending_before : null;
    if (startingAfter && endingBefore) {
      throw new LevelWireError(400, 'starting_after and ending_before cannot be combined');
    }
    if (endingBefore) {
      const index = items.findIndex((item) => item.id === endingBefore);
      if (index < 0) throw new LevelWireError(400, `Invalid ending_before cursor: ${endingBefore}`);
      const start = Math.max(0, index - limit);
      return { data: items.slice(start, index), has_more: start > 0 };
    }
    let start = 0;
    if (startingAfter) {
      const index = items.findIndex((item) => item.id === startingAfter);
      if (index < 0) throw new LevelWireError(400, `Invalid starting_after cursor: ${startingAfter}`);
      start = index + 1;
    }
    return { data: items.slice(start, start + limit), has_more: start + limit < items.length };
  }

  // ── Native webhooks ───────────────────────────────────────────────────────

  registerWebhook(input: {
    id?: string;
    url: string;
    secret?: string | null;
    eventTypes?: LevelEventType[];
    enabled?: boolean;
  }): LevelWebhookEndpoint {
    this.counters.webhook += 1;
    const webhook: LevelWebhookEndpoint = {
      id: input.id ?? `webhook-${this.counters.webhook}`,
      url: input.url,
      secret: input.secret ? input.secret : null,
      eventTypes: input.eventTypes && input.eventTypes.length ? [...input.eventTypes] : [...LEVEL_EVENT_TYPES],
      enabled: input.enabled ?? true,
    };
    this.webhooks.set(webhook.id, webhook);
    return webhook;
  }

  getWebhook(id: string): LevelWebhookEndpoint {
    const webhook = this.webhooks.get(id);
    if (!webhook) throw new LevelWireError(404, `Unknown webhook ${id}`);
    return webhook;
  }

  /** Records an event; delivery is the dispatcher's job. */
  emitEvent(eventType: LevelEventType, data: object): LevelWebhookEvent {
    const event: LevelWebhookEvent = {
      event_type: eventType,
      event_id: this.uuid(),
      occurred_at: this.now().toISOString(),
      // Snapshot at emission: retries and re-runs resend the original data.
      data: structuredClone(data) as Record<string, unknown>,
    };
    this.events.set(event.event_id, event);
    return event;
  }

  alertEventData(alert: LevelAlert): Record<string, unknown> {
    return { ...alert, ...(this.alertWebhookExtras.get(alert.id) ?? {}) };
  }

  subscribers(eventType: LevelEventType): LevelWebhookEndpoint[] {
    return [...this.webhooks.values()].filter((w) => w.enabled && w.eventTypes.includes(eventType));
  }

  /** The exact bytes Level sends (and signs) for an event. */
  serializeEvent(event: LevelWebhookEvent): string {
    return JSON.stringify(event);
  }

  recordDelivery(input: Omit<WebhookDeliveryRecord, 'id' | 'deliveredAt' | 'nextRetryAt'>): WebhookDeliveryRecord {
    this.counters.delivery += 1;
    let nextRetryAt: string | null = null;
    const retriesUsed = input.attempt - 1;
    if (!input.ok && input.trigger !== 'rerun' && retriesUsed < this.config.webhookMaxRetries) {
      const dueAtMs = this.now().getTime() + this.retryDelayMs(input.attempt);
      this.pendingRetries.push({ webhookId: input.webhookId, eventId: input.eventId, attempt: input.attempt + 1, dueAtMs });
      nextRetryAt = new Date(dueAtMs).toISOString();
    }
    const record: WebhookDeliveryRecord = {
      ...input,
      id: this.counters.delivery,
      deliveredAt: this.now().toISOString(),
      nextRetryAt,
    };
    this.deliveries.push(record);
    return record;
  }

  /** Exponential backoff with jitter: base, 2×base, 4×base … plus [0, jitter). */
  retryDelayMs(failedAttempt: number): number {
    return this.config.retryBaseDelayMs * 2 ** (failedAttempt - 1) + Math.floor(this.env.rng() * this.config.retryJitterMs);
  }

  /** Removes and returns retries due at `nowMs` — atomically, so two flushers never double-send. */
  takeDueRetries(nowMs: number): PendingRetry[] {
    const due = this.pendingRetries.filter((r) => r.dueAtMs <= nowMs);
    this.pendingRetries = this.pendingRetries.filter((r) => r.dueAtMs > nowMs);
    return due.sort((a, b) => a.dueAtMs - b.dueAtMs);
  }

  // ── Automations ───────────────────────────────────────────────────────────

  createAutomation(input: {
    id?: string;
    name: string;
    enabled?: boolean;
    alertNames?: string[];
    groupIds?: string[];
    action: Partial<HttpRequestAction> & { url: string };
    variables?: Record<string, string>;
    retries?: number;
  }): LevelAutomation {
    this.counters.automation += 1;
    const automation: LevelAutomation = {
      id: input.id ?? `automation-${this.counters.automation}`,
      name: input.name,
      enabled: input.enabled ?? true,
      trigger: { type: 'monitor', alertNames: input.alertNames ?? [], groupIds: input.groupIds ?? [] },
      action: {
        method: 'POST',
        contentType: 'application/json',
        headers: [],
        body: '',
        ...input.action,
      },
      variables: { ...(input.variables ?? {}) },
      retries: input.retries ?? 0,
    };
    this.automations.set(automation.id, automation);
    return automation;
  }

  getAutomation(id: string): LevelAutomation {
    const automation = this.automations.get(id);
    if (!automation) throw new LevelWireError(404, `Unknown automation ${id}`);
    return automation;
  }

  /** Automations whose monitor trigger matches an alert that just became active. */
  automationsForAlert(alert: LevelAlert): LevelAutomation[] {
    const device = this.devices.get(alert.device_id);
    return [...this.automations.values()].filter((automation) => {
      if (!automation.enabled) return false;
      const { alertNames, groupIds } = automation.trigger;
      if (alertNames.length && !alertNames.includes(alert.name)) return false;
      if (groupIds.length) {
        if (!device?.group_id) return false;
        return groupIds.some((groupId) => this.descendantGroupIds(groupId).has(device.group_id!));
      }
      return true;
    });
  }

  recordAutomationRun(input: Omit<AutomationRunRecord, 'id' | 'ranAt'>): AutomationRunRecord {
    this.counters.run += 1;
    const record: AutomationRunRecord = { ...input, id: this.counters.run, ranAt: this.now().toISOString() };
    this.automationRuns.push(record);
    return record;
  }
}
