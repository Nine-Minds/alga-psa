import { z } from 'zod';
import { getActionRegistryV2 } from '../../../../../../shared/workflow/runtime/registries/actionRegistry';
import {
  requirePermission,
  throwActionError,
  withTenantTransaction
} from '../../../../../../shared/workflow/runtime/actions/businessOperations/shared';
import type { ActionContext } from '../../../../../../shared/workflow/runtime/registries/actionRegistry';
import { registerIntegrationWorkflowModule, rmmIntegrationAvailability } from '../integrationModules';
import { workflowTenantTable } from '../../lib/workflowTenantDb';

const loadHuntressRuntimeSupport = () => import('./huntressWorkflowRuntimeSupport');

const PROVIDER = 'huntress';

const incidentSchema = z.object({
  incident_id: z.number().int(),
  status: z.string().nullable(),
  severity: z.string().nullable(),
  platform: z.string().nullable(),
  summary: z.string().nullable(),
  subject: z.string().nullable(),
  organization_id: z.number().int().nullable(),
  agent_id: z.number().int().nullable(),
  indicator_types: z.array(z.string()),
  sent_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  updated_at: z.string().nullable()
});

const organizationSchema = z.object({
  organization_id: z.number().int(),
  name: z.string().nullable(),
  agents_count: z.number().int().nullable()
});

const agentSchema = z.object({
  agent_id: z.number().int(),
  hostname: z.string().nullable(),
  platform: z.string().nullable(),
  os: z.string().nullable(),
  version: z.string().nullable(),
  organization_id: z.number().int().nullable(),
  last_callback_at: z.string().nullable(),
  ipv4_address: z.string().nullable()
});

const asNullableString = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

const asNullableInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};

const errorStatus = (error: unknown): number | undefined =>
  error instanceof Error ? (error as { status?: number }).status : undefined;

async function requireHuntressIntegration(ctx: ActionContext): Promise<{
  tenantId: string;
  knex: any;
  integrationId: string;
  instanceUrl: string | undefined;
}> {
  const tenantId = ctx.tenantId ?? null;
  if (!tenantId) {
    throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'tenantId is required' });
  }
  const { integrationId, instanceUrl } = await withTenantTransaction(ctx, async (tx) => {
    await requirePermission(ctx, tx, { resource: 'settings', action: 'update' });

    const integration = await workflowTenantTable(tx.trx, tenantId, 'rmm_integrations')
      .where({ provider: PROVIDER, is_active: true })
      .whereNotNull('connected_at')
      .first();
    if (!integration) {
      throwActionError(ctx, {
        category: 'ActionError',
        code: 'INTEGRATION_INACTIVE',
        message: 'Huntress integration is not active for this tenant. Connect it under Settings > Integrations > RMM.'
      });
    }

    return {
      integrationId: String(integration.integration_id),
      instanceUrl: integration.instance_url ? String(integration.instance_url) : undefined
    };
  });

  return {
    tenantId,
    knex: ctx.knex,
    integrationId,
    instanceUrl
  };
}

const normalizeIncident = (incident: any) => ({
  incident_id: Number(incident.id ?? 0),
  status: asNullableString(incident.status),
  severity: asNullableString(incident.severity),
  platform: asNullableString(incident.platform),
  summary: asNullableString(incident.summary),
  subject: asNullableString(incident.subject),
  organization_id: asNullableInt(incident.organization_id),
  agent_id: asNullableInt(incident.agent_id),
  indicator_types: Array.isArray(incident.indicator_types) ? incident.indicator_types.map(String) : [],
  sent_at: asNullableString(incident.sent_at),
  closed_at: asNullableString(incident.closed_at),
  updated_at: asNullableString(incident.updated_at)
});

const normalizeOrganization = (organization: any) => ({
  organization_id: Number(organization.id ?? 0),
  name: asNullableString(organization.name),
  agents_count: asNullableInt(organization.agents_count)
});

const normalizeAgent = (agent: any) => ({
  agent_id: Number(agent.id ?? 0),
  hostname: asNullableString(agent.hostname),
  platform: asNullableString(agent.platform),
  os: asNullableString(agent.os),
  version: asNullableString(agent.version),
  organization_id: asNullableInt(agent.organization_id),
  last_callback_at: asNullableString(agent.last_callback_at),
  ipv4_address: asNullableString(agent.ipv4_address)
});

let huntressRegistered = false;

export function registerHuntressWorkflowActionsV2(): void {
  if (huntressRegistered) return;
  const registry = getActionRegistryV2();

  registry.register({
    id: 'huntress.incidents.find',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      status: z.enum(['sent', 'closed', 'dismissed', 'auto_remediating', 'deleting', 'partner_dismissed']).optional(),
      severity: z.enum(['low', 'high', 'critical']).optional(),
      platform: z.string().trim().min(1).optional(),
      organization_id: z.coerce.number().int().positive().optional(),
      agent_id: z.coerce.number().int().positive().optional(),
      limit: z.number().int().min(1).max(500).default(50)
    }),
    outputSchema: z.object({
      incidents: z.array(incidentSchema),
      count: z.number().int()
    }),
    ui: {
      label: 'Find incident reports',
      description: 'Find Huntress SOC incident reports by status, severity, organization, or agent.',
      category: 'Huntress',
      icon: 'huntress'
    },
    handler: async (input, ctx) => {
      const { tenantId, instanceUrl } = await requireHuntressIntegration(ctx);
      const { createHuntressWorkflowClient } = await loadHuntressRuntimeSupport();
      const client = await createHuntressWorkflowClient(tenantId, instanceUrl);
      const incidents = (await client.listIncidentReports({
        status: input.status,
        severity: input.severity,
        platform: input.platform,
        organization_id: input.organization_id,
        agent_id: input.agent_id,
        limit: input.limit ?? 50
      })).map((incident) => normalizeIncident(incident));
      return { incidents, count: incidents.length };
    }
  });

  registry.register({
    id: 'huntress.incidents.get',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      incident_id: z.coerce.number().int().positive()
    }),
    outputSchema: z.object({
      incident: incidentSchema,
      body: z.string().nullable()
    }),
    ui: {
      label: 'Get incident report',
      description: 'Get one Huntress incident report, including its full report body for ticket enrichment.',
      category: 'Huntress',
      icon: 'huntress'
    },
    handler: async (input, ctx) => {
      const { tenantId, instanceUrl } = await requireHuntressIntegration(ctx);
      const { createHuntressWorkflowClient } = await loadHuntressRuntimeSupport();
      const client = await createHuntressWorkflowClient(tenantId, instanceUrl);
      try {
        const incident = await client.getIncidentReport(input.incident_id);
        return {
          incident: normalizeIncident(incident),
          body: asNullableString(incident.body)
        };
      } catch (error) {
        if (errorStatus(error) === 404) {
          throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: `Huntress incident report ${input.incident_id} not found` });
        }
        throw error;
      }
    }
  });

  registry.register({
    id: 'huntress.incidents.resolve',
    version: 1,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      incident_id: z.coerce.number().int().positive()
    }),
    outputSchema: z.object({
      resolved: z.boolean(),
      incident_id: z.number().int(),
      status: z.string().nullable()
    }),
    ui: {
      label: 'Resolve incident report',
      description: 'Resolve a Huntress incident report so the SOC and your tickets agree.',
      category: 'Huntress',
      icon: 'huntress'
    },
    handler: async (input, ctx) => {
      const { tenantId, instanceUrl } = await requireHuntressIntegration(ctx);
      const { createHuntressWorkflowClient } = await loadHuntressRuntimeSupport();
      const client = await createHuntressWorkflowClient(tenantId, instanceUrl);
      try {
        const incident = await client.resolveIncidentReport(input.incident_id);
        return {
          resolved: true,
          incident_id: input.incident_id,
          status: asNullableString(incident?.status) ?? 'closed'
        };
      } catch (error) {
        const status = errorStatus(error);
        if (status === 403) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'FORBIDDEN',
            message:
              'Huntress rejected the resolution: the default account API key is read-only. Use a user-based API key with permission to resolve incident reports.'
          });
        }
        if (status === 409 || status === 422) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'CONFLICT',
            message:
              'Huntress incident report cannot be resolved: all remediations must be approved and the report status must be "sent".'
          });
        }
        if (status === 404) {
          throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: `Huntress incident report ${input.incident_id} not found` });
        }
        throw error;
      }
    }
  });

  registry.register({
    id: 'huntress.organizations.list',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      query: z.string().trim().min(1).optional(),
      limit: z.number().int().min(1).max(500).default(100)
    }),
    outputSchema: z.object({
      organizations: z.array(organizationSchema),
      count: z.number().int()
    }),
    ui: {
      label: 'List organizations',
      description: 'List Huntress organizations for mapping and filtering.',
      category: 'Huntress',
      icon: 'huntress'
    },
    handler: async (input, ctx) => {
      const { tenantId, instanceUrl } = await requireHuntressIntegration(ctx);
      const { createHuntressWorkflowClient } = await loadHuntressRuntimeSupport();
      const client = await createHuntressWorkflowClient(tenantId, instanceUrl);
      const query = input.query?.toLowerCase();
      const organizations = (await client.listOrganizations())
        .map((organization) => normalizeOrganization(organization))
        .filter((organization) => !query || (organization.name ?? '').toLowerCase().includes(query))
        .slice(0, input.limit ?? 100);
      return { organizations, count: organizations.length };
    }
  });

  registry.register({
    id: 'huntress.agents.get',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      agent_id: z.coerce.number().int().positive()
    }),
    outputSchema: z.object({
      agent: agentSchema
    }),
    ui: {
      label: 'Get agent',
      description: 'Get one Huntress agent for incident enrichment.',
      category: 'Huntress',
      icon: 'huntress'
    },
    handler: async (input, ctx) => {
      const { tenantId, instanceUrl } = await requireHuntressIntegration(ctx);
      const { createHuntressWorkflowClient } = await loadHuntressRuntimeSupport();
      const client = await createHuntressWorkflowClient(tenantId, instanceUrl);
      try {
        const agent = await client.getAgent(input.agent_id);
        return { agent: normalizeAgent(agent) };
      } catch (error) {
        if (errorStatus(error) === 404) {
          throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: `Huntress agent ${input.agent_id} not found` });
        }
        throw error;
      }
    }
  });

  registry.register({
    id: 'huntress.account.get',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({}),
    outputSchema: z.object({
      account_id: z.number().int().nullable(),
      name: z.string().nullable(),
      subdomain: z.string().nullable()
    }),
    ui: {
      label: 'Get account',
      description: 'Get the connected Huntress account summary.',
      category: 'Huntress',
      icon: 'huntress'
    },
    handler: async (_input, ctx) => {
      const { tenantId, instanceUrl } = await requireHuntressIntegration(ctx);
      const { createHuntressWorkflowClient } = await loadHuntressRuntimeSupport();
      const client = await createHuntressWorkflowClient(tenantId, instanceUrl);
      const account = await client.getAccount();
      return {
        account_id: asNullableInt(account.id),
        name: asNullableString(account.name),
        subdomain: asNullableString(account.subdomain)
      };
    }
  });

  huntressRegistered = true;
}

export function registerHuntressWorkflowModule(): void {
  registerIntegrationWorkflowModule({
    module: {
      groupKey: 'app:huntress',
      label: 'Huntress',
      description: 'Huntress managed security actions for incident reports and agents.',
      tileKind: 'app',
      iconToken: 'huntress',
      defaultActionId: 'huntress.incidents.find',
      allowedActionIds: [
        'huntress.incidents.find',
        'huntress.incidents.get',
        'huntress.incidents.resolve',
        'huntress.organizations.list',
        'huntress.agents.get',
        'huntress.account.get'
      ],
      availabilityKey: 'rmm:huntress'
    },
    availability: rmmIntegrationAvailability(PROVIDER),
    registerActions: () => registerHuntressWorkflowActionsV2()
  });
}
