import { z } from 'zod';
import type { ControlRegistry } from '@alga-psa/emulator-host';
import type { ThreecxEmulatorCore } from './core';

const nullableText = z.string().nullable().optional();

const contactFields = z.object({
  FirstName: nullableText,
  LastName: nullableText,
  CompanyName: nullableText,
  Email: nullableText,
  PhoneNumber: nullableText,
  Business: nullableText,
  Business2: nullableText,
  Mobile2: nullableText,
  Home: nullableText,
  Other: nullableText,
  Tag: nullableText,
  ContactType: nullableText,
});

export function register(reg: ControlRegistry, core: ThreecxEmulatorCore): void {
  // ---- CRM engine (dials AlgaPSA) ----
  reg.action({
    name: 'crm-configure',
    description: 'Point the emulated 3CX CRM engine at a tenant: base URL, tenant slug, and API key',
    params: z.object({
      baseUrl: z.string().optional(),
      tenantSlug: z.string().optional(),
      apiKey: z.string().optional(),
    }),
    run: ({ baseUrl, tenantSlug, apiKey }) => core.configure({ baseUrl, tenantSlug, apiKey }),
  });

  reg.action({
    name: 'crm-inbound-call',
    description: 'Simulate an inbound call: GET lookup then POST report-call, exactly as the CRM engine would',
    params: z.object({
      number: z.string(),
      agentEmail: z.string(),
      agentExtension: z.string().optional(),
      answered: z.boolean().optional(),
      durationSeconds: z.number().int().nonnegative().optional(),
      transcription: z.string().optional(),
      summary: z.string().optional(),
      recordingUrl: z.string().optional(),
    }),
    run: (input) => core.crmInboundCall(input),
  });

  reg.action({
    name: 'crm-outbound-call',
    description: 'Simulate an outbound call: GET lookup then POST report-call with callType Outbound',
    params: z.object({
      number: z.string(),
      agentEmail: z.string(),
      agentExtension: z.string().optional(),
      durationSeconds: z.number().int().nonnegative().optional(),
      transcription: z.string().optional(),
      summary: z.string().optional(),
      recordingUrl: z.string().optional(),
    }),
    run: (input) => core.crmOutboundCall(input),
  });

  reg.action({
    name: 'crm-search',
    description: 'Simulate a free-text search from the 3CX client (GET search)',
    params: z.object({ q: z.string() }),
    run: ({ q }) => core.crmSearch(q),
  });

  reg.action({
    name: 'crm-create-contact',
    description: 'Simulate "create contact" from the 3CX client: POST contacts with the bearer key',
    params: z.object({
      firstName: z.string(),
      lastName: z.string(),
      number: z.string(),
      email: z.string().optional(),
      company: z.string().optional(),
    }),
    run: (input) => core.crmCreateContact(input),
  });

  reg.action({
    name: 'crm-report-chat',
    description: 'Simulate a finished live chat: POST report-chat with the bearer key',
    params: z.object({
      number: z.string().optional(),
      email: z.string().optional(),
      name: z.string().optional(),
      agentEmail: z.string(),
      queueExtension: z.string().optional(),
      durationSeconds: z.number().int().nonnegative().optional(),
      messages: z.string(),
      startTimeUtc: z.string().optional(),
      endTimeUtc: z.string().optional(),
      entityId: z.string().optional(),
      entityType: z.string().optional(),
    }),
    run: (input) => core.crmReportChat(input),
  });

  // ---- PBX seeds ----
  reg.seeder({
    name: 'pbx-app',
    description: 'An API app (client credentials) the PBX accepts at POST /connect/token, with its capabilities',
    params: z.object({
      clientId: z.string(),
      clientSecret: z.string(),
      callControl: z.boolean().optional(),
      xapi: z.boolean().optional(),
    }),
    run: (input) => core.seedApp(input),
  });

  reg.seeder({
    name: 'pbx-user',
    description: 'A PBX extension (Pbx.User) listed by GET /xapi/v1/Users and /callcontrol',
    params: z.object({
      dn: z.string(),
      email: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      enabled: z.boolean().optional(),
    }),
    run: (input) => core.seedUser(input),
  });

  reg.seeder({
    name: 'pbx-contact',
    description: 'A phonebook entry (Pbx.Contact); returns it with its Id',
    params: contactFields,
    run: (input) => core.createContact(input),
  });

  reg.seeder({
    name: 'cdr-segment',
    description: 'A CallHistoryView row (one call segment); SegmentId is assigned when omitted',
    params: z.object({
      SegmentId: z.number().int().positive().optional(),
      SegmentStartTime: z.string(),
      SegmentEndTime: z.string(),
      CallTime: z.string().default('PT0S'),
      CallAnswered: z.boolean().default(true),
      SrcDn: z.string().default(''),
      SrcCallerNumber: z.string().default(''),
      SrcDisplayName: z.string().default(''),
      SrcExternal: z.boolean().default(false),
      DstDn: z.string().default(''),
      DstCallerNumber: z.string().default(''),
      DstDisplayName: z.string().default(''),
      DstExternal: z.boolean().default(false),
    }),
    run: (input) => core.seedCdrSegment(input),
  });

  reg.seeder({
    name: 'recording',
    description: 'A call recording with optional transcript/summary; bytesBase64 sets what DownloadRecording streams',
    params: z.object({
      Id: z.number().int().positive().optional(),
      StartTime: z.string(),
      EndTime: z.string(),
      FromCallerNumber: z.string().default(''),
      ToCallerNumber: z.string().default(''),
      FromDn: z.string().default(''),
      ToDn: z.string().default(''),
      IsTranscribed: z.boolean().default(false),
      Transcription: nullableText.default(null),
      Summary: nullableText.default(null),
      RecordingUrl: nullableText.default(null),
      bytesBase64: z.string().optional(),
    }),
    run: (input) => core.seedRecording(input),
  });

  // ---- PBX call-control actions ----
  reg.action({
    name: 'pbx-ring',
    description: 'An inbound call starts ringing an extension: creates a Ringing participant and pushes an Upsert on the WebSocket',
    params: z.object({
      dn: z.string(),
      callerNumber: z.string(),
      callerName: z.string().optional(),
      directControl: z.boolean().optional(),
      did: z.string().optional(),
    }),
    run: (input) => core.ring(input),
  });

  reg.action({
    name: 'pbx-answer',
    description: 'The extension answers: participant status becomes Connected and an Upsert is pushed',
    params: z.object({ participantId: z.number().int().positive() }),
    run: ({ participantId }) => core.answer(participantId),
  });

  reg.action({
    name: 'pbx-hangup',
    description: 'The call ends: the participant is removed and a Remove is pushed',
    params: z.object({ participantId: z.number().int().positive() }),
    run: ({ participantId }) => core.hangup(participantId),
  });

  // ---- Faults ----
  reg.fault({
    name: 'token-invalid',
    description: 'POST /connect/token answers 401 while armed (already issued tokens keep working)',
    arm: () => {
      core.tokenInvalid = true;
    },
    disarm: () => {
      core.tokenInvalid = false;
    },
  });

  reg.fault({
    name: 'ws-drop',
    description: 'Closes every open /callcontrol/ws socket once when armed; reconnects succeed. Disarm only clears the flag',
    arm: () => {
      core.dropConnections();
    },
    disarm: () => undefined,
  });

  // ---- State views ----
  reg.stateView({
    name: 'config',
    description: 'The configured target (API key masked)',
    get: () => core.redactedTarget(),
  });

  reg.stateView({
    name: 'exchanges',
    description: 'Every request/response pair the emulator sent, with status codes',
    get: () => core.exchanges,
  });

  reg.stateView({
    name: 'pbx-users',
    description: 'Seeded extensions as GET /xapi/v1/Users lists them',
    get: () => [...core.users.values()],
  });

  reg.stateView({
    name: 'pbx-contacts',
    description: 'The PBX phonebook: seeded plus everything AlgaPSA pushed through /xapi/v1/Contacts',
    get: () => [...core.contacts.values()],
  });

  reg.stateView({
    name: 'cdr-segments',
    description: 'Seeded CallHistoryView rows',
    get: () => [...core.cdrSegments.values()],
  });

  reg.stateView({
    name: 'recordings',
    description: 'Seeded recordings (metadata only)',
    get: () => [...core.recordings.values()],
  });

  reg.stateView({
    name: 'makecalls',
    description: 'Every MakeCall the PBX received, with dn, destination and which surface placed it',
    get: () => core.makecalls,
  });

  reg.stateView({
    name: 'participants',
    description: 'Live call-control participants by id',
    get: () => [...core.participants.values()],
  });

  reg.stateView({
    name: 'tokens',
    description: 'Bearer tokens issued at /connect/token (masked) with their app and expiry',
    get: () => core.redactedTokens(),
  });
}
