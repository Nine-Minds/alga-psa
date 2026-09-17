import type { EmulatorCore, HostEnv } from '@alga-psa/emulator-host';
import { ControlError } from '@alga-psa/emulator-host';
import {
  THREECX_QUERY_PARAMS,
  THREECX_ROUTE_SEGMENTS,
  threecxRouteUrl,
} from '@alga-psa/ee-threecx/lib/routeConstants';

export interface ThreecxTarget {
  baseUrl: string;
  tenantSlug: string;
  apiKey: string;
}

export interface ThreecxExchange {
  action: string;
  request: { method: string; path: string; url: string; body?: unknown };
  response: { status: number; body: unknown };
}

export interface ThreecxInboundCallInput {
  number: string;
  agentEmail: string;
  agentExtension?: string;
  answered?: boolean;
  durationSeconds?: number;
  /** PBX-side AI artifacts the CRM engine substitutes into [Transcription]/[Summary]. */
  transcription?: string;
  summary?: string;
  recordingUrl?: string;
}

export interface ThreecxCreateContactInput {
  firstName: string;
  lastName: string;
  number: string;
  email?: string;
  company?: string;
}

export interface ThreecxReportChatInput {
  number?: string;
  email?: string;
  name?: string;
  agentEmail: string;
  queueExtension?: string;
  durationSeconds?: number;
  messages: string;
  startTimeUtc?: string;
  endTimeUtc?: string;
  entityId?: string;
  entityType?: string;
}

// ---- PBX side (what the 3CX XAPI / call-control surfaces serve) ----

export interface PbxApp {
  clientId: string;
  clientSecret: string;
  callControl: boolean;
  xapi: boolean;
}

export interface PbxUser {
  Id: number;
  Number: string;
  FirstName: string;
  LastName: string;
  EmailAddress: string;
  Enabled: boolean;
}

export interface PbxContact {
  Id: number;
  FirstName: string | null;
  LastName: string | null;
  CompanyName: string | null;
  Email: string | null;
  PhoneNumber: string | null;
  Business: string | null;
  Business2: string | null;
  Mobile2: string | null;
  Home: string | null;
  Other: string | null;
  Tag: string | null;
  ContactType: string | null;
}

export type PbxContactInput = Partial<Omit<PbxContact, 'Id'>>;

export interface CdrSegment {
  SegmentId: number;
  SegmentStartTime: string;
  SegmentEndTime: string;
  /** ISO-8601 duration, e.g. PT1M35S. */
  CallTime: string;
  CallAnswered: boolean;
  SrcDn: string;
  SrcCallerNumber: string;
  SrcDisplayName: string;
  SrcExternal: boolean;
  DstDn: string;
  DstCallerNumber: string;
  DstDisplayName: string;
  DstExternal: boolean;
}

export interface PbxRecording {
  Id: number;
  StartTime: string;
  EndTime: string;
  FromCallerNumber: string;
  ToCallerNumber: string;
  FromDn: string;
  ToDn: string;
  IsTranscribed: boolean;
  Transcription: string | null;
  Summary: string | null;
  RecordingUrl: string | null;
}

export interface PbxToken {
  token: string;
  clientId: string;
  issuedAt: string;
  expiresAt: string;
}

export interface MakeCallRecord {
  dn: string;
  destination: string;
  via: 'xapi' | 'callcontrol';
  participantId: number;
  at: string;
}

export type ParticipantStatus = 'Ringing' | 'Dialing' | 'Connected';

export interface Participant {
  id: number;
  status: ParticipantStatus;
  dn: string;
  party_caller_id: string;
  party_caller_name: string;
  party_did: string;
  callid: number;
  legid: number;
}

export const EVENT_UPSERT = 0;
export const EVENT_REMOVE = 1;

export interface CallControlEvent {
  sequence: number;
  event: { event_type: typeof EVENT_UPSERT | typeof EVENT_REMOVE; entity: string; attached_data: null };
}

export const TOKEN_TTL_SECONDS = 3600;
const DEFAULT_RECORDING_BYTES = Buffer.from('RIFF....WAVEfmt ', 'latin1');

type FetchImpl = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<{ status: number; json(): Promise<unknown>; text(): Promise<string> }>;

function redactKey(value: string): string {
  if (!value) return '';
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

function participantEntity(p: Pick<Participant, 'dn' | 'id'>): string {
  return `/callcontrol/${p.dn}/participants/${p.id}`;
}

/** Sequence numbers keep counting across resets, like a PBX process would. */
let processSequence = 0;

/**
 * Both halves of 3CX in one core: the CRM engine that dials the AlgaPSA
 * routes (recording every exchange), and the PBX that AlgaPSA dials back —
 * XAPI (users, contacts, call history, recordings) and call control
 * (participants, makecall, the WebSocket event feed).
 */
function firstLookupContact(lookup?: ThreecxExchange): { entityId?: string; entityType?: string } | null {
  const body = lookup?.response?.body as { contacts?: Array<{ entityId?: string; entityType?: string }> } | undefined;
  return body?.contacts?.[0] ?? null;
}

export class ThreecxEmulatorCore implements EmulatorCore {
  private target: ThreecxTarget = { baseUrl: '', tenantSlug: '', apiKey: '' };
  readonly exchanges: ThreecxExchange[] = [];
  /** Injectable so unit tests can drive the loop without a live server. */
  fetchImpl: FetchImpl = (url, init) => (globalThis.fetch as unknown as FetchImpl)(url, init);

  readonly apps = new Map<string, PbxApp>();
  readonly users = new Map<string, PbxUser>();
  readonly contacts = new Map<number, PbxContact>();
  readonly cdrSegments = new Map<number, CdrSegment>();
  readonly recordings = new Map<number, PbxRecording>();
  private readonly recordingBytes = new Map<number, Buffer>();
  readonly tokens = new Map<string, PbxToken>();
  readonly makecalls: MakeCallRecord[] = [];
  readonly participants = new Map<number, Participant>();
  tokenInvalid = false;

  private nextId = { user: 1, contact: 1, segment: 1, recording: 1, participant: 1, call: 1 };
  private readonly eventListeners = new Set<(event: CallControlEvent) => void>();
  private readonly connections = new Set<() => void>();

  constructor(private readonly env: HostEnv) {}

  reset(): void {
    this.target = { baseUrl: '', tenantSlug: '', apiKey: '' };
    this.exchanges.length = 0;
    for (const map of [this.apps, this.users, this.contacts, this.cdrSegments, this.recordings, this.recordingBytes, this.tokens, this.participants]) {
      map.clear();
    }
    this.makecalls.length = 0;
    this.tokenInvalid = false;
    this.nextId = { user: 1, contact: 1, segment: 1, recording: 1, participant: 1, call: 1 };
  }

  snapshot(): unknown {
    return {
      target: this.target,
      apps: [...this.apps.values()],
      users: [...this.users.values()],
      contacts: [...this.contacts.values()],
      cdrSegments: [...this.cdrSegments.values()],
      recordings: [...this.recordings.values()].map((r) => ({
        ...r,
        bytesBase64: this.recordingBytes.get(r.Id)?.toString('base64'),
      })),
      nextId: this.nextId,
    };
  }

  restore(state: unknown): void {
    const s = (state ?? {}) as Partial<{
      target: ThreecxTarget;
      apps: PbxApp[];
      users: PbxUser[];
      contacts: PbxContact[];
      cdrSegments: CdrSegment[];
      recordings: Array<PbxRecording & { bytesBase64?: string }>;
      nextId: { user: number; contact: number; segment: number; recording: number; participant: number; call: number };
    }>;
    if (s.target) this.target = { ...this.target, ...s.target };
    for (const app of s.apps ?? []) this.apps.set(app.clientId, app);
    for (const user of s.users ?? []) this.users.set(user.Number, user);
    for (const contact of s.contacts ?? []) this.contacts.set(contact.Id, contact);
    for (const segment of s.cdrSegments ?? []) this.cdrSegments.set(segment.SegmentId, segment);
    for (const { bytesBase64, ...recording } of s.recordings ?? []) {
      this.recordings.set(recording.Id, recording);
      if (bytesBase64) this.recordingBytes.set(recording.Id, Buffer.from(bytesBase64, 'base64'));
    }
    if (s.nextId) this.nextId = { ...this.nextId, ...s.nextId };
  }

  // ---- CRM engine: dials AlgaPSA ----

  configure(input: Partial<ThreecxTarget>): ThreecxTarget {
    this.target = {
      baseUrl: input.baseUrl ?? this.target.baseUrl,
      tenantSlug: input.tenantSlug ?? this.target.tenantSlug,
      apiKey: input.apiKey ?? this.target.apiKey,
    };
    return this.redactedTarget();
  }

  redactedTarget(): ThreecxTarget {
    return {
      baseUrl: this.target.baseUrl,
      tenantSlug: this.target.tenantSlug,
      apiKey: redactKey(this.target.apiKey),
    };
  }

  private routeUrl(segment: string): string {
    return threecxRouteUrl(this.target.baseUrl, this.target.tenantSlug, segment);
  }

  private lookupUrl(number: string): string {
    return `${this.routeUrl(THREECX_ROUTE_SEGMENTS.lookup)}?${THREECX_QUERY_PARAMS.number}=${encodeURIComponent(number)}`;
  }

  private searchUrl(q: string): string {
    return `${this.routeUrl(THREECX_ROUTE_SEGMENTS.search)}?${THREECX_QUERY_PARAMS.q}=${encodeURIComponent(q)}`;
  }

  private async send(
    action: string,
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
  ): Promise<ThreecxExchange> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.target.apiKey}` };
    if (body !== undefined) headers['content-type'] = 'application/json';

    const res = await this.fetchImpl(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    let responseBody: unknown = null;
    try {
      responseBody = await res.json();
    } catch {
      responseBody = null;
    }

    const exchange: ThreecxExchange = {
      action,
      request: { method, path: new URL(url).pathname, url, ...(body !== undefined ? { body } : {}) },
      response: { status: res.status, body: responseBody },
    };
    this.exchanges.push(exchange);
    return exchange;
  }

  private reportBody(input: {
    callType: 'Inbound' | 'Outbound' | 'Missed' | 'Notanswered';
    number: string;
    agentEmail: string;
    agentExtension?: string;
    durationSeconds: number;
    lookup?: ThreecxExchange;
    transcription?: string;
    summary?: string;
    recordingUrl?: string;
  }): Record<string, unknown> {
    const start = this.env.clock.now();
    const end = new Date(start.getTime() + input.durationSeconds * 1000);
    const missed = input.callType === 'Missed' || input.callType === 'Notanswered';
    // The CRM engine carries the first lookup hit's EntityId/EntityType into ReportCall.
    const first = firstLookupContact(input.lookup);
    return {
      callType: input.callType,
      number: input.number,
      agentExtension: input.agentExtension ?? '',
      agentEmail: input.agentEmail,
      queueExtension: '',
      durationSeconds: missed ? 0 : input.durationSeconds,
      startTimeUtc: start.toISOString(),
      establishedTimeUtc: missed ? '' : start.toISOString(),
      endTimeUtc: end.toISOString(),
      entityId: first?.entityId ?? '',
      entityType: first?.entityType ?? '',
      transcription: input.transcription ?? '',
      summary: input.summary ?? '',
      recordingUrl: input.recordingUrl ?? '',
    };
  }

  async crmInboundCall(input: ThreecxInboundCallInput): Promise<ThreecxExchange[]> {
    const answered = input.answered !== false;
    const lookup = await this.send('crm-inbound-call', 'GET', this.lookupUrl(input.number));
    const report = await this.send(
      'crm-inbound-call',
      'POST',
      this.routeUrl(THREECX_ROUTE_SEGMENTS.reportCall),
      this.reportBody({
        callType: answered ? 'Inbound' : 'Missed',
        number: input.number,
        agentEmail: input.agentEmail,
        agentExtension: input.agentExtension,
        durationSeconds: answered ? input.durationSeconds ?? 0 : 0,
        lookup,
        transcription: input.transcription,
        summary: input.summary,
        recordingUrl: input.recordingUrl,
      }),
    );
    return [lookup, report];
  }

  async crmOutboundCall(input: ThreecxInboundCallInput): Promise<ThreecxExchange[]> {
    const lookup = await this.send('crm-outbound-call', 'GET', this.lookupUrl(input.number));
    const report = await this.send(
      'crm-outbound-call',
      'POST',
      this.routeUrl(THREECX_ROUTE_SEGMENTS.reportCall),
      this.reportBody({
        callType: 'Outbound',
        number: input.number,
        agentEmail: input.agentEmail,
        agentExtension: input.agentExtension,
        durationSeconds: input.durationSeconds ?? 0,
        lookup,
        transcription: input.transcription,
        summary: input.summary,
        recordingUrl: input.recordingUrl,
      }),
    );
    return [lookup, report];
  }

  async crmSearch(q: string): Promise<ThreecxExchange> {
    return this.send('crm-search', 'GET', this.searchUrl(q));
  }

  /** Mirrors the CreateContactRecordFromClient scenario body ([FirstName] ... [Company]). */
  async crmCreateContact(input: ThreecxCreateContactInput): Promise<ThreecxExchange> {
    return this.send('crm-create-contact', 'POST', this.routeUrl(THREECX_ROUTE_SEGMENTS.contacts), {
      firstName: input.firstName,
      lastName: input.lastName,
      number: input.number,
      email: input.email ?? '',
      company: input.company ?? '',
    });
  }

  /** Mirrors the ReportChat scenario body ([Number] ... [ChatMessages]). */
  async crmReportChat(input: ThreecxReportChatInput): Promise<ThreecxExchange> {
    const duration = input.durationSeconds ?? 0;
    const start = input.startTimeUtc ? new Date(input.startTimeUtc) : this.env.clock.now();
    const end = input.endTimeUtc ?? new Date(start.getTime() + duration * 1000).toISOString();
    return this.send('crm-report-chat', 'POST', this.routeUrl(THREECX_ROUTE_SEGMENTS.reportChat), {
      number: input.number ?? '',
      email: input.email ?? '',
      name: input.name ?? '',
      agentEmail: input.agentEmail,
      queueExtension: input.queueExtension ?? '',
      durationSeconds: duration,
      startTimeUtc: start.toISOString(),
      endTimeUtc: end,
      messages: input.messages,
      entityId: input.entityId ?? '',
      entityType: input.entityType ?? '',
    });
  }

  // ---- PBX: seeds ----

  seedApp(input: { clientId: string; clientSecret: string; callControl?: boolean; xapi?: boolean }): PbxApp {
    const app: PbxApp = {
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      callControl: input.callControl ?? true,
      xapi: input.xapi ?? true,
    };
    this.apps.set(app.clientId, app);
    return { ...app, clientSecret: redactKey(app.clientSecret) };
  }

  seedUser(input: { dn: string; email: string; firstName: string; lastName: string; enabled?: boolean }): PbxUser {
    const existing = this.users.get(input.dn);
    const user: PbxUser = {
      Id: existing?.Id ?? this.nextId.user++,
      Number: input.dn,
      FirstName: input.firstName,
      LastName: input.lastName,
      EmailAddress: input.email,
      Enabled: input.enabled ?? true,
    };
    this.users.set(user.Number, user);
    return user;
  }

  createContact(input: PbxContactInput): PbxContact {
    const contact: PbxContact = {
      Id: this.nextId.contact++,
      FirstName: input.FirstName ?? null,
      LastName: input.LastName ?? null,
      CompanyName: input.CompanyName ?? null,
      Email: input.Email ?? null,
      PhoneNumber: input.PhoneNumber ?? null,
      Business: input.Business ?? null,
      Business2: input.Business2 ?? null,
      Mobile2: input.Mobile2 ?? null,
      Home: input.Home ?? null,
      Other: input.Other ?? null,
      Tag: input.Tag ?? null,
      ContactType: input.ContactType ?? null,
    };
    this.contacts.set(contact.Id, contact);
    return contact;
  }

  patchContact(id: number, patch: PbxContactInput): PbxContact | null {
    const existing = this.contacts.get(id);
    if (!existing) return null;
    const { Id: _ignored, ...fields } = patch as Partial<PbxContact>;
    const updated = { ...existing, ...fields, Id: id };
    this.contacts.set(id, updated);
    return updated;
  }

  seedCdrSegment(input: Omit<CdrSegment, 'SegmentId'> & { SegmentId?: number }): CdrSegment {
    const segment: CdrSegment = { ...input, SegmentId: input.SegmentId ?? this.nextId.segment++ };
    if (segment.SegmentId >= this.nextId.segment) this.nextId.segment = segment.SegmentId + 1;
    this.cdrSegments.set(segment.SegmentId, segment);
    return segment;
  }

  seedRecording(input: Omit<PbxRecording, 'Id'> & { Id?: number; bytesBase64?: string }): PbxRecording {
    const { bytesBase64, ...fields } = input;
    const recording: PbxRecording = { ...fields, Id: input.Id ?? this.nextId.recording++ };
    if (recording.Id >= this.nextId.recording) this.nextId.recording = recording.Id + 1;
    this.recordings.set(recording.Id, recording);
    this.recordingBytes.set(recording.Id, bytesBase64 ? Buffer.from(bytesBase64, 'base64') : DEFAULT_RECORDING_BYTES);
    return recording;
  }

  recordingBytesFor(id: number): Buffer | null {
    if (!this.recordings.has(id)) return null;
    return this.recordingBytes.get(id) ?? DEFAULT_RECORDING_BYTES;
  }

  // ---- PBX: tokens ----

  private randomHex(bytes: number): string {
    let out = '';
    for (let i = 0; i < bytes; i++) out += Math.floor(this.env.rng() * 256).toString(16).padStart(2, '0');
    return out;
  }

  /** `POST /connect/token`: null when the credentials do not match a seeded app or the fault is armed. */
  issueToken(clientId: string, clientSecret: string): PbxToken | null {
    if (this.tokenInvalid) return null;
    const app = this.apps.get(clientId);
    if (!app || app.clientSecret !== clientSecret) return null;
    const issued = this.env.clock.now();
    const token: PbxToken = {
      token: `3cx_${this.randomHex(16)}`,
      clientId,
      issuedAt: issued.toISOString(),
      expiresAt: new Date(issued.getTime() + TOKEN_TTL_SECONDS * 1000).toISOString(),
    };
    this.tokens.set(token.token, token);
    return token;
  }

  /** The app behind a bearer, or null when unknown, expired, or its app was dropped. */
  appForToken(bearer: string | null | undefined): PbxApp | null {
    if (!bearer) return null;
    const token = this.tokens.get(bearer);
    if (!token) return null;
    if (new Date(token.expiresAt).getTime() <= this.env.clock.now().getTime()) return null;
    return this.apps.get(token.clientId) ?? null;
  }

  redactedTokens(): Array<Omit<PbxToken, 'token'> & { token: string }> {
    return [...this.tokens.values()].map((t) => ({ ...t, token: redactKey(t.token) }));
  }

  // ---- PBX: call control ----

  onEvent(listener: (event: CallControlEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private push(eventType: CallControlEvent['event']['event_type'], entity: string): CallControlEvent {
    const event: CallControlEvent = {
      sequence: ++processSequence,
      event: { event_type: eventType, entity, attached_data: null },
    };
    for (const listener of this.eventListeners) listener(event);
    return event;
  }

  /** The listener registers each open socket's closer; `ws-drop` fires them. */
  trackConnection(close: () => void): () => void {
    this.connections.add(close);
    return () => this.connections.delete(close);
  }

  dropConnections(): number {
    const closers = [...this.connections];
    this.connections.clear();
    for (const close of closers) close();
    return closers.length;
  }

  private newParticipant(fields: Omit<Participant, 'id' | 'callid' | 'legid'>): Participant {
    const participant: Participant = { ...fields, id: this.nextId.participant++, callid: this.nextId.call++, legid: 1 };
    this.participants.set(participant.id, participant);
    this.push(EVENT_UPSERT, participantEntity(participant));
    return participant;
  }

  makeCall(dn: string, destination: string, via: MakeCallRecord['via']): Participant {
    const participant = this.newParticipant({
      status: 'Dialing',
      dn,
      party_caller_id: destination,
      party_caller_name: '',
      party_did: '',
    });
    this.makecalls.push({ dn, destination, via, participantId: participant.id, at: this.env.clock.now().toISOString() });
    return participant;
  }

  ring(input: { dn: string; callerNumber: string; callerName?: string; did?: string }): Participant {
    return this.newParticipant({
      status: 'Ringing',
      dn: input.dn,
      party_caller_id: input.callerNumber,
      party_caller_name: input.callerName ?? '',
      party_did: input.did ?? '',
    });
  }

  private requireParticipant(id: number): Participant {
    const participant = this.participants.get(id);
    if (!participant) throw new ControlError(404, `Unknown participant ${id}`);
    return participant;
  }

  answer(participantId: number): Participant {
    const participant = { ...this.requireParticipant(participantId), status: 'Connected' as const };
    this.participants.set(participant.id, participant);
    this.push(EVENT_UPSERT, participantEntity(participant));
    return participant;
  }

  hangup(participantId: number): { removed: Participant; event: CallControlEvent } {
    const removed = this.requireParticipant(participantId);
    this.participants.delete(participantId);
    return { removed, event: this.push(EVENT_REMOVE, participantEntity(removed)) };
  }
}
