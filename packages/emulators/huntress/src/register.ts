import { z } from 'zod';
import type { ControlRegistry } from '@alga-psa/emulator-host';
import { ControlError } from '@alga-psa/emulator-host';
import {
  HUNTRESS_ACCOUNT_STATUSES,
  HUNTRESS_AGENT_PLATFORMS,
  HUNTRESS_DETERMINATIONS,
  HUNTRESS_ESCALATION_STATUSES,
  HUNTRESS_INCIDENT_PLATFORMS,
  HUNTRESS_INCIDENT_STATUSES,
  HUNTRESS_INDICATOR_TYPES,
  HUNTRESS_RESOLUTION_SCOPES,
  HUNTRESS_SEVERITIES,
  HUNTRESS_SUPPORT_TYPES,
  HuntressWireError,
} from './core';
import type { HuntressCredential, HuntressEmulatorCore } from './core';

/**
 * Control inputs are typed from the core methods they feed rather than from
 * the zod schemas. A consumer that compiles this package without
 * strictNullChecks (EE's tsc includes its tests, which import the emulator
 * source) sees every z.infer key as optional, which no longer satisfies the
 * core signatures.
 */
// LEVERAGE: friction ee-tsc-compiles-foreign-package-sources-nonstrict — ee/server/tsconfig.json (strict:false) type-checks emulator src through package `types`, so zod inference cannot be the control signature.
type OrganizationSeedInput = Parameters<HuntressEmulatorCore['createOrganization']>[0];
type AgentSeedInput = Parameters<HuntressEmulatorCore['createAgent']>[0];
type IncidentSeedInput = Parameters<HuntressEmulatorCore['createIncident']>[0];
type EscalationSeedInput = Parameters<HuntressEmulatorCore['createEscalation']>[0];
type IncidentPatch = Parameters<HuntressEmulatorCore['updateIncident']>[1];
type EscalationPatch = Parameters<HuntressEmulatorCore['updateEscalation']>[1];
type ResolutionParams = Parameters<HuntressEmulatorCore['resolveEscalation']>[1];

function mask(value: string): string {
  return value.length <= 8 ? '••••' : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function maskedCredential(credential: HuntressCredential) {
  return { ...credential, secret: mask(credential.secret) };
}

/** Core errors surface as control errors with the same status. */
async function control<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HuntressWireError) throw new ControlError(error.status, error.message);
    throw error;
  }
}

const Severity = z.enum(HUNTRESS_SEVERITIES);
const IncidentStatus = z.enum(HUNTRESS_INCIDENT_STATUSES);
const EscalationStatus = z.enum(HUNTRESS_ESCALATION_STATUSES);

const Credential = z.object({
  key: z.string().min(1),
  secret: z.string().min(1),
  escalationsWrite: z.boolean().default(true),
});

const Remediation = z
  .object({
    id: z.number().int().optional(),
    type: z.string(),
    action: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    parameters: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
    approved_at: z.string().nullable().optional(),
    approved_by: z.object({ id: z.string(), email: z.string(), name: z.string() }).nullable().optional(),
    completed_at: z.string().nullable().optional(),
  })
  .passthrough();

const Entity = z.object({
  id: z.number().int().optional(),
  type: z.enum(['Agent', 'Identity']),
  details: z.record(z.string(), z.unknown()).optional(),
});

export function register(reg: ControlRegistry, core: HuntressEmulatorCore): void {
  // ── Configuration and credentials ──────────────────────────────────────

  reg.action({
    name: 'configure',
    description:
      'Replace the accepted Basic-auth credential pairs (key/secret, escalationsWrite for the resolution endpoint) and set the account name/subdomain/status',
    params: z.object({
      credentials: z.array(Credential).optional(),
      accountName: z.string().optional(),
      accountSubdomain: z.string().optional(),
      accountStatus: z.enum(HUNTRESS_ACCOUNT_STATUSES).optional(),
    }),
    run: (patch) => {
      const config = core.configure(patch as Parameters<HuntressEmulatorCore['configure']>[0]);
      return { ...config, credentials: config.credentials.map(maskedCredential) };
    },
  });

  reg.seeder({
    name: 'account',
    description:
      'Set the account GET /v1/account returns (id, name, subdomain, status, support_type, neighborhood_watch, billing/shipping address)',
    params: z
      .object({
        id: z.number().int().optional(),
        name: z.string().optional(),
        subdomain: z.string().optional(),
        status: z.enum(HUNTRESS_ACCOUNT_STATUSES).optional(),
        support_type: z.enum(HUNTRESS_SUPPORT_TYPES).optional(),
        neighborhood_watch: z.record(z.string(), z.number()).optional(),
        billing_address: z.record(z.string(), z.unknown()).nullable().optional(),
        shipping_address: z.record(z.string(), z.unknown()).nullable().optional(),
      })
      .passthrough(),
    run: (patch) => ({ account: core.setAccount(patch as Parameters<HuntressEmulatorCore['setAccount']>[0]) }),
  });

  reg.seeder({
    name: 'credential',
    description: 'Accept another API key/secret pair (Account API credentials are read-only in Huntress unless escalationsWrite is set)',
    params: Credential,
    run: (input) => {
      const credential = input as HuntressCredential;
      const existing = core.config.credentials.findIndex((c) => c.key === credential.key);
      if (existing >= 0) core.config.credentials[existing] = { ...credential };
      else core.config.credentials.push({ ...credential });
      return { credentials: core.config.credentials.map(maskedCredential) };
    },
  });

  // ── Organizations ──────────────────────────────────────────────────────

  reg.seeder({
    name: 'organization',
    description:
      'Create an organization (name, key, counts, report_recipients, actual_usages for the detail endpoint). `count` seeds that many numbered organizations in one call, for multi-page walks',
    params: z
      .object({
        id: z.number().int().optional(),
        name: z.string(),
        key: z.string().optional(),
        count: z.number().int().min(1).max(5000).optional(),
        agents_count: z.number().int().optional(),
        incident_reports_count: z.number().int().optional(),
        logs_sources_count: z.number().int().optional(),
        identity_provider_tenant_id: z.string().nullable().optional(),
        billable_identity_count: z.number().int().optional(),
        sat_learner_count: z.number().int().optional(),
        report_recipients: z.array(z.string()).optional(),
        actual_usages: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
    run: (raw) =>
      control(() => {
        const { count, ...input } = raw as OrganizationSeedInput & { count?: number };
        if (!count || count === 1) return { created: 1, organizations: [core.createOrganization(input)] };
        const organizations = [];
        for (let index = 1; index <= count; index += 1) {
          organizations.push(core.createOrganization({ ...input, id: undefined, name: `${input.name} ${index}` }));
        }
        return { created: organizations.length, organizations };
      }),
  });

  reg.action({
    name: 'delete-organization',
    description: 'Remove an organization (GET /v1/organizations/:id then answers 404); incidents keep their organization_id',
    params: z.object({ organizationId: z.number().int() }),
    run: ({ organizationId }) => control(() => ({ organization: core.deleteOrganization(organizationId) })),
  });

  // ── Agents ─────────────────────────────────────────────────────────────

  reg.seeder({
    name: 'agent',
    description:
      'Create an agent (hostname, organization_id, platform, os/os_major/os_minor/os_patch/os_build_version, ipv4_address(es), mac_addresses, serial_number, defender_*, firewall_status, tamper_protection_*, tags, last_callback_at …)',
    params: z
      .object({
        id: z.number().int().optional(),
        hostname: z.string(),
        organization_id: z.number().int().nullable().optional(),
        platform: z.enum(HUNTRESS_AGENT_PLATFORMS).optional(),
        os: z.string().nullable().optional(),
        ipv4_address: z.string().nullable().optional(),
        ipv4_addresses: z.array(z.string()).optional(),
        serial_number: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
      })
      .passthrough(),
    run: (input) => control(() => ({ agent: core.createAgent(input as AgentSeedInput) })),
  });

  reg.action({
    name: 'update-agent',
    description: 'Patch an agent (any documented Agent field); bumps updated_at',
    params: z.object({ agentId: z.number().int(), patch: z.record(z.string(), z.unknown()) }),
    run: ({ agentId, patch }) => control(() => ({ agent: core.updateAgent(agentId, patch) })),
  });

  reg.action({
    name: 'delete-agent',
    description: 'Remove an agent (GET /v1/agents/:id then answers 404); incidents keep their agent_id',
    params: z.object({ agentId: z.number().int() }),
    run: ({ agentId }) => control(() => ({ agent: core.deleteAgent(agentId) })),
  });

  // ── Incident reports ───────────────────────────────────────────────────

  reg.seeder({
    name: 'incident',
    description:
      'Create an incident report (organization_id, agent_id, subject/summary/body, severity, status, platform, indicator_types/indicator_counts, remediations, sent_at/closed_at, created_at/updated_at)',
    params: z
      .object({
        id: z.number().int().optional(),
        organization_id: z.number().int().nullable().optional(),
        agent_id: z.number().int().nullable().optional(),
        subject: z.string().nullable().optional(),
        summary: z.string().nullable().optional(),
        body: z.string().nullable().optional(),
        severity: Severity.optional(),
        status: IncidentStatus.optional(),
        platform: z.enum(HUNTRESS_INCIDENT_PLATFORMS).nullable().optional(),
        indicator_types: z.array(z.enum(HUNTRESS_INDICATOR_TYPES)).optional(),
        indicator_counts: z.record(z.string(), z.number()).optional(),
        psa_ticket_eids: z.array(z.string()).optional(),
        remediations: z.array(Remediation).optional(),
        sent_at: z.string().nullable().optional(),
        closed_at: z.string().nullable().optional(),
        created_at: z.string().optional(),
        updated_at: z.string().optional(),
      })
      .passthrough(),
    run: (input) =>
      control(() => ({ incident_report: core.presentIncident(core.createIncident(input as IncidentSeedInput)) })),
  });

  reg.action({
    name: 'update-incident',
    description:
      'A SOC status change (sent → closed/dismissed/partner_dismissed/auto_remediating/deleting/draft): stamps status_updated_at, sets closed_at for closed, bumps updated_at',
    params: z.object({
      incidentId: z.number().int(),
      status: IncidentStatus.optional(),
      severity: Severity.optional(),
      subject: z.string().nullable().optional(),
      summary: z.string().nullable().optional(),
      body: z.string().nullable().optional(),
      psa_ticket_eids: z.array(z.string()).optional(),
    }),
    run: ({ incidentId, ...patch }: IncidentPatch & { incidentId: number }) =>
      control(() => ({ incident_report: core.presentIncident(core.updateIncident(incidentId, patch)) })),
  });

  reg.action({
    name: 'touch-incident',
    description: 'Bump updated_at only — the "updated but same status" path a cursor walk still has to collect',
    params: z.object({ incidentId: z.number().int() }),
    run: ({ incidentId }) =>
      control(() => ({ incident_report: core.presentIncident(core.touchIncident(incidentId)) })),
  });

  // ── Escalations ────────────────────────────────────────────────────────

  reg.seeder({
    name: 'escalation',
    description:
      'Create an escalation spanning zero, one or many organizations, with Agent/Identity entities, type/type_code/subtype, severity, status, psa_ticket_eids. due_at only feeds the documented sort_field; api_resolvable: false makes the resolution endpoint answer 422',
    params: z
      .object({
        id: z.number().int().optional(),
        organization_ids: z.array(z.number().int()).optional(),
        severity: Severity.optional(),
        status: EscalationStatus.optional(),
        subject: z.string().optional(),
        type: z.string().optional(),
        type_code: z.string().optional(),
        subtype: z.string().nullable().optional(),
        psa_ticket_eids: z.array(z.string()).optional(),
        entities: z.array(Entity).optional(),
        due_at: z.string().nullable().optional(),
        api_resolvable: z.boolean().optional(),
        created_at: z.string().optional(),
        updated_at: z.string().optional(),
      })
      .passthrough(),
    run: (input) =>
      control(() => ({
        escalation: core.presentEscalation(core.createEscalation(input as EscalationSeedInput), { withEntities: true }),
      })),
  });

  reg.action({
    name: 'update-escalation',
    description:
      'Move an escalation (open ↔ overdue → resolved), add/remove/replace its organizations, replace its entities, change type/type_code/subtype/severity/subject/psa_ticket_eids; bumps updated_at',
    params: z.object({
      escalationId: z.number().int(),
      status: EscalationStatus.optional(),
      severity: Severity.optional(),
      subject: z.string().optional(),
      type: z.string().optional(),
      type_code: z.string().optional(),
      subtype: z.string().nullable().optional(),
      psa_ticket_eids: z.array(z.string()).optional(),
      organization_ids: z.array(z.number().int()).optional(),
      addOrganizationIds: z.array(z.number().int()).optional(),
      removeOrganizationIds: z.array(z.number().int()).optional(),
      entities: z.array(Entity).optional(),
      due_at: z.string().nullable().optional(),
    }),
    run: ({ escalationId, ...patch }: EscalationPatch & { escalationId: number }) =>
      control(() => ({
        escalation: core.presentEscalation(core.updateEscalation(escalationId, patch), { withEntities: true }),
      })),
  });

  reg.action({
    name: 'resolve-escalation',
    description:
      'Resolve an escalation the way POST /v1/escalations/:id/resolution does (determination/scope only for Unwanted Access types; both omitted there is the portal\'s "dismiss")',
    params: z.object({
      escalationId: z.number().int(),
      determination: z.enum(HUNTRESS_DETERMINATIONS).optional(),
      scope: z.enum(HUNTRESS_RESOLUTION_SCOPES).optional(),
      expiration_date: z.string().optional(),
      ip_address: z.string().optional(),
      revoke_and_disable_identities: z.boolean().optional(),
    }),
    run: ({ escalationId, ...params }: ResolutionParams & { escalationId: number }) =>
      control(() => {
        const resolved = core.resolveEscalation(escalationId, params, { escalationsWrite: true });
        return {
          escalation: core.presentEscalation(resolved.escalation, { withEntities: true }),
          resolution_method: resolved.resolution_method,
        };
      }),
  });

  // ── Faults ─────────────────────────────────────────────────────────────

  reg.fault({
    name: 'operation-fault',
    description:
      'Fail one operation ("GET /v1/incident_reports", "GET /v1/escalations/:id", "POST /v1/escalations/:id/resolution", a trailing-* prefix, or "*") N times with a status and the emulator\'s error envelope',
    params: z.object({
      operation: z.string(),
      status: z.number().int().min(400).max(599).default(500),
      message: z.string().default('Internal Server Error'),
      retryAfterSeconds: z.number().int().min(0).nullable().optional(),
      remaining: z.number().int().positive().default(1),
    }),
    arm: ({ operation, status, message, retryAfterSeconds, remaining }) =>
      core.armOperationFault({
        operation,
        status: status ?? 500,
        message: message ?? 'Internal Server Error',
        retryAfterSeconds: retryAfterSeconds ?? null,
        remaining: remaining ?? 1,
      }),
    disarm: () => core.disarmOperationFaults(),
  });

  reg.fault({
    name: 'rate-limit',
    description:
      'Answer the next N requests with 429 and Retry-After — Huntress rate limits every account to 60 requests/minute on a sliding window',
    params: z.object({
      remaining: z.number().int().positive().default(1),
      retryAfterSeconds: z.number().int().min(0).default(1),
    }),
    arm: ({ remaining, retryAfterSeconds }) =>
      core.armOperationFault({
        operation: '*',
        status: 429,
        message: 'Too Many Requests',
        retryAfterSeconds: retryAfterSeconds ?? 1,
        remaining: remaining ?? 1,
      }),
    disarm: () => core.disarmOperationFaults(),
  });

  // ── State views ────────────────────────────────────────────────────────

  reg.stateView({
    name: 'config',
    description: 'Accepted credentials (secrets masked) and the account GET /v1/account serves',
    get: () => ({
      credentials: core.config.credentials.map(maskedCredential),
      account: core.config.account,
    }),
  });
  reg.stateView({
    name: 'organizations',
    description: 'Organizations with their detail-only actual_usages',
    get: () => [...core.organizations.values()].map((organization) => core.presentOrganization(organization, { withUsages: true })),
  });
  reg.stateView({ name: 'agents', description: 'Agents as /v1/agents serves them', get: () => [...core.agents.values()] });
  reg.stateView({
    name: 'incidents',
    description: 'Incident reports, including drafts (which the list endpoint hides)',
    get: () => [...core.incidents.values()].map((incident) => core.presentIncident(incident)),
  });
  reg.stateView({
    name: 'escalations',
    description: 'Escalations with their entities and the internal due_at / api_resolvable flags',
    get: () =>
      [...core.escalations.values()].map((escalation) => ({
        ...core.presentEscalation(escalation, { withEntities: true }),
        internal: escalation.internal,
      })),
  });
  reg.stateView({
    name: 'auth-failures',
    description: 'Requests rejected with 403: when, method, path and why',
    get: () => core.authFailures,
  });
  reg.stateView({ name: 'operation-faults', description: 'Armed REST faults', get: () => core.operationFaults });
}
