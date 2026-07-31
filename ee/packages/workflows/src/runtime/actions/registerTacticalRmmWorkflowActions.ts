import { z } from 'zod';
import { getActionRegistryV2 } from '../../../../../../shared/workflow/runtime/registries/actionRegistry';
import {
  requirePermission,
  throwActionError,
  withTenantTransaction
} from '../../../../../../shared/workflow/runtime/actions/businessOperations/shared';
import type { ActionContext } from '../../../../../../shared/workflow/runtime/registries/actionRegistry';
import { registerIntegrationWorkflowModule, rmmIntegrationAvailability } from '../integrationModules';
import type { TacticalAuthMode } from './tacticalRmmWorkflowRuntimeSupport';
import { workflowTenantTable } from '../../lib/workflowTenantDb';

const loadTacticalRuntimeSupport = () => import('./tacticalRmmWorkflowRuntimeSupport');

const PROVIDER = 'tacticalrmm';
const RMM_COMMAND_PERMISSION = { resource: 'rmm', action: 'execute_command' } as const;

const agentSchema = z.object({
  agent_id: z.string(),
  asset_id: z.string().uuid().nullable(),
  hostname: z.string().nullable(),
  organization_id: z.string().nullable(),
  agent_online: z.boolean().nullable(),
  last_seen_at: z.string().nullable(),
  os_name: z.string().nullable(),
  source: z.enum(['local', 'tacticalrmm'])
});

const scriptSchema = z.object({
  id: z.number().int().nullable(),
  name: z.string().nullable(),
  shell: z.string().nullable(),
  category: z.string().nullable(),
  description: z.string().nullable()
});

const toNullableIsoString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return String(value);
};

const parseSettings = (settings: unknown): Record<string, unknown> => {
  if (!settings) return {};
  if (typeof settings === 'string') {
    try {
      return JSON.parse(settings) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof settings === 'object' && !Array.isArray(settings)) return settings as Record<string, unknown>;
  return {};
};

async function requireTacticalIntegration(ctx: ActionContext): Promise<{
  tenantId: string;
  knex: any;
  integrationId: string;
  instanceUrl: string;
  authMode: TacticalAuthMode;
}> {
  const tenantId = ctx.tenantId ?? null;
  if (!tenantId) {
    throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'tenantId is required' });
  }
  const knex = ctx.knex;
  if (!knex) {
    throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: 'Database connection unavailable' });
  }

  const integration = await workflowTenantTable(knex, tenantId, 'rmm_integrations')
    .where({ provider: PROVIDER, is_active: true })
    .whereNotNull('connected_at')
    .first();
  if (!integration) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'INTEGRATION_INACTIVE',
      message: 'Tactical RMM integration is not active for this tenant. Connect it under Settings > Integrations > RMM.'
    });
  }

  const settings = parseSettings(integration.settings);
  const instanceUrl = String(integration.instance_url ?? '').trim();
  if (!instanceUrl) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'INTEGRATION_MISCONFIGURED',
      message: 'Tactical RMM integration has no instance URL configured.'
    });
  }

  return {
    tenantId,
    knex,
    integrationId: String(integration.integration_id),
    instanceUrl,
    authMode: (settings.auth_mode as TacticalAuthMode | undefined) ?? 'api_key'
  };
}

async function requireRmmCommandPermission(ctx: ActionContext): Promise<void> {
  await withTenantTransaction(ctx, async (tx) => {
    await requirePermission(ctx, tx, RMM_COMMAND_PERMISSION);
  });
}

const normalizeAgentStatus = (agent: Record<string, unknown>): boolean | null => {
  const status = agent.status ?? agent.agent_status;
  if (typeof status === 'string' && status.trim()) {
    return status.trim().toLowerCase() === 'online';
  }
  return null;
};

const normalizeTacticalAgent = (agent: any, source: 'local' | 'tacticalrmm') => ({
  agent_id: String(agent.agent_id ?? agent.rmm_device_id ?? ''),
  asset_id: agent.asset_id ?? null,
  hostname: agent.hostname ?? agent.name ?? agent.computer_name ?? null,
  organization_id:
    agent.client_id !== undefined && agent.client_id !== null
      ? String(agent.client_id)
      : (agent.rmm_organization_id ?? null),
  agent_online: normalizeAgentStatus(agent),
  last_seen_at: toNullableIsoString(agent.last_seen ?? agent.last_seen_at),
  os_name: agent.operating_system ?? agent.os_type ?? null,
  source
});

const normalizeTacticalScript = (script: any) => ({
  id: typeof script.id === 'number' ? script.id : null,
  name: typeof script.name === 'string' ? script.name : null,
  shell: typeof script.shell === 'string' ? script.shell : null,
  category: typeof script.category === 'string' ? script.category : null,
  description: typeof script.description === 'string' ? script.description : null
});

const extractCommandOutput = (vendorResponse: unknown): string | null => {
  if (typeof vendorResponse === 'string') return vendorResponse;
  if (vendorResponse && typeof vendorResponse === 'object' && !Array.isArray(vendorResponse)) {
    const record = vendorResponse as Record<string, unknown>;
    for (const key of ['output', 'stdout', 'result']) {
      if (typeof record[key] === 'string') return record[key] as string;
    }
  }
  return null;
};

let tacticalRegistered = false;

export function registerTacticalRmmWorkflowActionsV2(): void {
  if (tacticalRegistered) return;
  const registry = getActionRegistryV2();

  registry.register({
    id: 'tacticalrmm.agents.find',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      agent_id: z.string().trim().min(1).optional(),
      asset_id: z.string().uuid().optional(),
      query: z.string().trim().min(1).optional(),
      live: z.boolean().default(false),
      limit: z.number().int().min(1).max(200).default(50)
    }),
    outputSchema: z.object({
      agents: z.array(agentSchema),
      count: z.number().int()
    }),
    ui: {
      label: 'Find agents',
      description: 'Find Tactical RMM agents from synced assets and optional live API lookup.',
      category: 'Tactical RMM',
      icon: 'tacticalrmm'
    },
    handler: async (input, ctx) => {
      const { tenantId, knex, instanceUrl, authMode } = await requireTacticalIntegration(ctx);
      const rows = await workflowTenantTable(knex, tenantId, 'assets')
        .where({ rmm_provider: PROVIDER })
        .whereNotNull('rmm_device_id')
        .modify((qb: any) => {
          if (input.asset_id) qb.andWhere('asset_id', input.asset_id);
          if (input.agent_id) qb.andWhere('rmm_device_id', input.agent_id);
          if (input.query) {
            qb.andWhere((inner: any) => {
              inner
                .whereILike('name', `%${input.query}%`)
                .orWhereILike('asset_tag', `%${input.query}%`)
                .orWhereILike('serial_number', `%${input.query}%`);
            });
          }
        })
        .limit(input.limit ?? 50);

      const localAgents = rows.map((row: any) => normalizeTacticalAgent(row, 'local'));
      if (!input.live) {
        return { agents: localAgents, count: localAgents.length };
      }

      const { createTacticalWorkflowClient } = await loadTacticalRuntimeSupport();
      const client = await createTacticalWorkflowClient({ tenantId, instanceUrl, authMode });
      const liveRows = input.agent_id
        ? [await client.getAgent(input.agent_id)]
        : await client.listAgents(input.query ? { hostname: input.query } : {});
      const liveAgents = liveRows
        .map((agent) => normalizeTacticalAgent(agent, 'tacticalrmm'))
        .slice(0, input.limit ?? 50);
      return { agents: liveAgents, count: liveAgents.length };
    }
  });

  registry.register({
    id: 'tacticalrmm.agents.get',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      agent_id: z.string().trim().min(1)
    }),
    outputSchema: z.object({
      agent: agentSchema
    }),
    ui: {
      label: 'Get agent',
      description: 'Get one Tactical RMM agent by its agent ID.',
      category: 'Tactical RMM',
      icon: 'tacticalrmm'
    },
    handler: async (input, ctx) => {
      const { tenantId, instanceUrl, authMode } = await requireTacticalIntegration(ctx);
      const { createTacticalWorkflowClient } = await loadTacticalRuntimeSupport();
      const client = await createTacticalWorkflowClient({ tenantId, instanceUrl, authMode });
      const agent = await client.getAgent(input.agent_id);
      return { agent: normalizeTacticalAgent(agent, 'tacticalrmm') };
    }
  });

  registry.register({
    id: 'tacticalrmm.scripts.list',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      query: z.string().trim().min(1).optional(),
      limit: z.number().int().min(1).max(500).default(100)
    }),
    outputSchema: z.object({
      scripts: z.array(scriptSchema),
      count: z.number().int()
    }),
    ui: {
      label: 'List scripts',
      description: 'List the Tactical RMM script library so script IDs are discoverable.',
      category: 'Tactical RMM',
      icon: 'tacticalrmm'
    },
    handler: async (input, ctx) => {
      const { tenantId, instanceUrl, authMode } = await requireTacticalIntegration(ctx);
      const { createTacticalWorkflowClient } = await loadTacticalRuntimeSupport();
      const client = await createTacticalWorkflowClient({ tenantId, instanceUrl, authMode });
      const rows = await client.listScripts();
      const query = input.query?.toLowerCase();
      const scripts = rows
        .map((row) => normalizeTacticalScript(row))
        .filter((script) => !query || (script.name ?? '').toLowerCase().includes(query))
        .slice(0, input.limit ?? 100);
      return { scripts, count: scripts.length };
    }
  });

  registry.register({
    id: 'tacticalrmm.agents.run_script',
    version: 1,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      agent_id: z.string().trim().min(1),
      script_id: z.coerce.number().int().positive(),
      args: z.array(z.string()).default([]),
      timeout: z.number().int().min(1).max(3600).default(90),
      run_as_user: z.boolean().default(false),
      wait_for_output: z.boolean().default(true)
    }),
    outputSchema: z.object({
      run_requested: z.boolean(),
      agent_id: z.string(),
      output: z.string().nullable(),
      vendor_response: z.unknown().nullable()
    }),
    ui: {
      label: 'Run script',
      description: 'Run a stored script on a Tactical RMM agent and capture its output.',
      category: 'Tactical RMM',
      icon: 'tacticalrmm'
    },
    handler: async (input, ctx) => {
      const { tenantId, instanceUrl, authMode } = await requireTacticalIntegration(ctx);
      const { createTacticalWorkflowClient } = await loadTacticalRuntimeSupport();
      const client = await createTacticalWorkflowClient({ tenantId, instanceUrl, authMode });
      const vendorResponse = await client.runScript(input.agent_id, {
        script: input.script_id,
        args: input.args ?? [],
        timeout: input.timeout ?? 90,
        run_as_user: input.run_as_user ?? false,
        output: (input.wait_for_output ?? true) ? 'wait' : 'forget'
      });
      return {
        run_requested: true,
        agent_id: input.agent_id,
        output: extractCommandOutput(vendorResponse),
        vendor_response: vendorResponse ?? null
      };
    }
  });

  registry.register({
    id: 'tacticalrmm.agents.run_command',
    version: 1,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      agent_id: z.string().trim().min(1),
      command: z.string().trim().min(1),
      shell: z.string().trim().min(1).default('powershell'),
      timeout: z.number().int().min(1).max(3600).default(30),
      run_as_user: z.boolean().default(false)
    }),
    outputSchema: z.object({
      run_requested: z.boolean(),
      agent_id: z.string(),
      output: z.string().nullable(),
      vendor_response: z.unknown().nullable()
    }),
    ui: {
      label: 'Run command',
      description: 'Run a raw shell command on a Tactical RMM agent and capture its output.',
      category: 'Tactical RMM',
      icon: 'tacticalrmm'
    },
    handler: async (input, ctx) => {
      const { tenantId, instanceUrl, authMode } = await requireTacticalIntegration(ctx);
      await requireRmmCommandPermission(ctx);
      const { createTacticalWorkflowClient } = await loadTacticalRuntimeSupport();
      const client = await createTacticalWorkflowClient({ tenantId, instanceUrl, authMode });
      const vendorResponse = await client.runCommand(input.agent_id, {
        shell: input.shell ?? 'powershell',
        cmd: input.command,
        timeout: input.timeout ?? 30,
        run_as_user: input.run_as_user ?? false
      });
      return {
        run_requested: true,
        agent_id: input.agent_id,
        output: extractCommandOutput(vendorResponse),
        vendor_response: vendorResponse ?? null
      };
    }
  });

  registry.register({
    id: 'tacticalrmm.agents.reboot',
    version: 1,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      agent_id: z.string().trim().min(1)
    }),
    outputSchema: z.object({
      reboot_requested: z.boolean(),
      agent_id: z.string()
    }),
    ui: {
      label: 'Reboot agent',
      description: 'Send a reboot command to a Tactical RMM agent.',
      category: 'Tactical RMM',
      icon: 'tacticalrmm'
    },
    handler: async (input, ctx) => {
      const { tenantId, instanceUrl, authMode } = await requireTacticalIntegration(ctx);
      const { createTacticalWorkflowClient } = await loadTacticalRuntimeSupport();
      const client = await createTacticalWorkflowClient({ tenantId, instanceUrl, authMode });
      await client.rebootAgent(input.agent_id);
      return { reboot_requested: true, agent_id: input.agent_id };
    }
  });

  tacticalRegistered = true;
}

export function registerTacticalRmmWorkflowModule(): void {
  registerIntegrationWorkflowModule({
    module: {
      groupKey: 'app:tacticalrmm',
      label: 'Tactical RMM',
      description: 'Tactical RMM actions for agents, scripts, and remote execution.',
      tileKind: 'app',
      iconToken: 'tacticalrmm',
      defaultActionId: 'tacticalrmm.agents.find',
      allowedActionIds: [
        'tacticalrmm.agents.find',
        'tacticalrmm.agents.get',
        'tacticalrmm.scripts.list',
        'tacticalrmm.agents.run_script',
        'tacticalrmm.agents.run_command',
        'tacticalrmm.agents.reboot'
      ],
      availabilityKey: 'rmm:tacticalrmm'
    },
    availability: rmmIntegrationAvailability(PROVIDER),
    registerActions: () => registerTacticalRmmWorkflowActionsV2()
  });
}
