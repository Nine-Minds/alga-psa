import { z } from 'zod';
import { getActionRegistryV2 } from '../../../../../../shared/workflow/runtime/registries/actionRegistry';
import { throwActionError } from '../../../../../../shared/workflow/runtime/actions/businessOperations/shared';
import type { ActionContext } from '../../../../../../shared/workflow/runtime/registries/actionRegistry';
import { registerIntegrationWorkflowModule, rmmIntegrationAvailability } from '../integrationModules';
import { workflowTenantTable } from '../../lib/workflowTenantDb';

const loadLevelRuntimeSupport = () => import('./levelIoWorkflowRuntimeSupport');

const isLevelApiErrorWithStatus = (error: unknown, status: number): boolean =>
  error instanceof Error && (error as { status?: number }).status === status;

const PROVIDER = 'levelio';

const deviceSchema = z.object({
  device_id: z.string(),
  asset_id: z.string().uuid().nullable(),
  hostname: z.string().nullable(),
  nickname: z.string().nullable(),
  group_id: z.string().nullable(),
  online: z.boolean().nullable(),
  platform: z.string().nullable(),
  os_name: z.string().nullable(),
  serial_number: z.string().nullable(),
  last_seen_at: z.string().nullable(),
  security_score: z.number().nullable(),
  source: z.enum(['local', 'levelio'])
});

const alertSchema = z.object({
  alert_id: z.string(),
  device_id: z.string().nullable(),
  device_hostname: z.string().nullable(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  severity: z.string().nullable(),
  is_resolved: z.boolean(),
  started_at: z.string().nullable(),
  resolved_at: z.string().nullable()
});

const updateSchema = z.object({
  update_id: z.string(),
  device_id: z.string().nullable(),
  device_hostname: z.string().nullable(),
  name: z.string().nullable(),
  category: z.string().nullable(),
  is_available: z.boolean().nullable(),
  installed_on: z.string().nullable()
});

const automationSchema = z.object({
  automation_id: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  group_id: z.string().nullable(),
  group_name: z.string().nullable(),
  webhook_token: z.string().nullable(),
  webhook_requires_authorization: z.boolean().nullable()
});

const runSchema = z.object({
  run_id: z.string(),
  automation_id: z.string().nullable(),
  automation_name: z.string().nullable(),
  device_id: z.string().nullable(),
  device_hostname: z.string().nullable(),
  status: z.string().nullable(),
  started_at: z.string().nullable(),
  ended_at: z.string().nullable()
});

const asNullableString = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

async function requireLevelIntegration(ctx: ActionContext): Promise<{
  tenantId: string;
  knex: any;
  integrationId: string;
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
      message: 'Level integration is not active for this tenant. Connect it under Settings > Integrations > RMM.'
    });
  }

  return { tenantId, knex, integrationId: String(integration.integration_id) };
}

const normalizeLevelDevice = (device: any, source: 'local' | 'levelio') => ({
  device_id: String(device.id ?? device.rmm_device_id ?? ''),
  asset_id: device.asset_id ?? null,
  hostname: device.hostname ?? device.name ?? null,
  nickname: device.nickname ?? null,
  group_id: asNullableString(device.group_id ?? device.rmm_organization_id),
  online: typeof device.online === 'boolean' ? device.online : null,
  platform: device.platform ?? null,
  os_name: device.operating_system?.full_operating_system ?? device.os_type ?? null,
  serial_number: device.serial_number ?? null,
  last_seen_at: asNullableString(
    device.last_seen_at instanceof Date ? device.last_seen_at.toISOString() : device.last_seen_at
  ),
  security_score: typeof device.security_score === 'number' ? device.security_score : null,
  source
});

const normalizeLevelAlert = (alert: any) => ({
  alert_id: String(alert.id ?? alert.external_alert_id ?? ''),
  device_id: asNullableString(alert.device_id ?? alert.external_device_id),
  device_hostname: alert.device_hostname ?? null,
  name: alert.name ?? alert.alert_class ?? null,
  description: alert.description ?? alert.message ?? null,
  severity: alert.severity ?? null,
  is_resolved: typeof alert.is_resolved === 'boolean'
    ? alert.is_resolved
    : String(alert.status ?? '').toLowerCase() === 'resolved',
  started_at: asNullableString(
    alert.started_at instanceof Date ? alert.started_at.toISOString() : (alert.started_at ?? alert.triggered_at)
  ),
  resolved_at: asNullableString(alert.resolved_at)
});

const normalizeLevelUpdate = (update: any) => ({
  update_id: String(update.id ?? ''),
  device_id: asNullableString(update.device_id),
  device_hostname: update.device_hostname ?? null,
  name: update.name ?? null,
  category: update.category ?? null,
  is_available: typeof update.is_available === 'boolean' ? update.is_available : null,
  installed_on: asNullableString(update.installed_on)
});

const extractWebhookToken = (url: unknown): string | null => {
  if (typeof url !== 'string' || !url) return null;
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? null;
  } catch {
    return null;
  }
};

const normalizeLevelRun = (run: any) => ({
  run_id: String(run.id ?? ''),
  automation_id: asNullableString(run.automation_id),
  automation_name: run.automation_name ?? null,
  device_id: asNullableString(run.device_id),
  device_hostname: run.device_hostname ?? null,
  status: run.status ?? null,
  started_at: asNullableString(run.started_at),
  ended_at: asNullableString(run.ended_at)
});

let levelRegistered = false;

export function registerLevelIoWorkflowActionsV2(): void {
  if (levelRegistered) return;
  const registry = getActionRegistryV2();

  registry.register({
    id: 'levelio.devices.find',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      device_id: z.string().trim().min(1).optional(),
      asset_id: z.string().uuid().optional(),
      group_id: z.string().trim().min(1).optional(),
      query: z.string().trim().min(1).optional(),
      live: z.boolean().default(false),
      limit: z.number().int().min(1).max(200).default(50)
    }),
    outputSchema: z.object({
      devices: z.array(deviceSchema),
      count: z.number().int()
    }),
    ui: {
      label: 'Find devices',
      description: 'Find Level devices from synced assets and optional live API lookup.',
      category: 'Level',
      icon: 'levelio'
    },
    handler: async (input, ctx) => {
      const { tenantId, knex } = await requireLevelIntegration(ctx);
      const rows = await workflowTenantTable(knex, tenantId, 'assets')
        .where({ rmm_provider: PROVIDER })
        .whereNotNull('rmm_device_id')
        .modify((qb: any) => {
          if (input.asset_id) qb.andWhere('asset_id', input.asset_id);
          if (input.device_id) qb.andWhere('rmm_device_id', input.device_id);
          if (input.group_id) qb.andWhere('rmm_organization_id', input.group_id);
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

      const localDevices = rows.map((row: any) => normalizeLevelDevice(row, 'local'));
      if (!input.live) {
        return { devices: localDevices, count: localDevices.length };
      }

      const { createLevelWorkflowClient } = await loadLevelRuntimeSupport();
      const client = await createLevelWorkflowClient(tenantId);
      const liveRows = input.device_id
        ? [await client.getDevice(input.device_id)]
        : await client.listDevices(input.group_id ? { groupId: input.group_id } : {});
      const query = input.query?.toLowerCase();
      const liveDevices = liveRows
        .map((device) => normalizeLevelDevice(device, 'levelio'))
        .filter((device) => !query || (device.hostname ?? '').toLowerCase().includes(query))
        .slice(0, input.limit ?? 50);
      return { devices: liveDevices, count: liveDevices.length };
    }
  });

  registry.register({
    id: 'levelio.devices.get',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      device_id: z.string().trim().min(1)
    }),
    outputSchema: z.object({
      device: deviceSchema
    }),
    ui: {
      label: 'Get device',
      description: 'Get one Level device with OS and security detail.',
      category: 'Level',
      icon: 'levelio'
    },
    handler: async (input, ctx) => {
      const { tenantId } = await requireLevelIntegration(ctx);
      const { createLevelWorkflowClient } = await loadLevelRuntimeSupport();
      const client = await createLevelWorkflowClient(tenantId);
      const device = await client.getDevice(input.device_id);
      return { device: normalizeLevelDevice(device, 'levelio') };
    }
  });

  registry.register({
    id: 'levelio.alerts.list_active',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      device_id: z.string().trim().min(1).optional(),
      live: z.boolean().default(false),
      limit: z.number().int().min(1).max(200).default(50)
    }),
    outputSchema: z.object({
      alerts: z.array(alertSchema),
      count: z.number().int()
    }),
    ui: {
      label: 'List active alerts',
      description: 'List active Level alerts for downstream workflow mapping.',
      category: 'Level',
      icon: 'levelio'
    },
    handler: async (input, ctx) => {
      const { tenantId, knex, integrationId } = await requireLevelIntegration(ctx);
      if (!input.live) {
        const rows = await workflowTenantTable(knex, tenantId, 'rmm_alerts')
          .where({ integration_id: integrationId, status: 'active' })
          .modify((qb: any) => {
            if (input.device_id) qb.andWhere('external_device_id', input.device_id);
          })
          .orderBy('triggered_at', 'desc')
          .limit(input.limit ?? 50);
        const alerts = rows.map((row: any) => normalizeLevelAlert(row));
        return { alerts, count: alerts.length };
      }

      const { createLevelWorkflowClient } = await loadLevelRuntimeSupport();
      const client = await createLevelWorkflowClient(tenantId);
      const alerts = (await client.listAlerts({ deviceId: input.device_id, status: 'active' }))
        .map((alert) => normalizeLevelAlert(alert))
        .slice(0, input.limit ?? 50);
      return { alerts, count: alerts.length };
    }
  });

  registry.register({
    id: 'levelio.alerts.resolve',
    version: 1,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      alert_id: z.string().trim().min(1)
    }),
    outputSchema: z.object({
      resolved: z.boolean(),
      alert_id: z.string()
    }),
    ui: {
      label: 'Resolve alert',
      description: 'Resolve a Level alert so the two systems agree.',
      category: 'Level',
      icon: 'levelio'
    },
    handler: async (input, ctx) => {
      const { tenantId, knex, integrationId } = await requireLevelIntegration(ctx);
      const { createLevelWorkflowClient } = await loadLevelRuntimeSupport();
      const client = await createLevelWorkflowClient(tenantId);
      await client.resolveAlert(input.alert_id);
      await workflowTenantTable(knex, tenantId, 'rmm_alerts')
        .where({ integration_id: integrationId, external_alert_id: input.alert_id })
        .update({ status: 'resolved', updated_at: new Date().toISOString() });
      return { resolved: true, alert_id: input.alert_id };
    }
  });

  registry.register({
    id: 'levelio.updates.list',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      device_id: z.string().trim().min(1).optional(),
      status: z.enum(['available', 'installed']).optional(),
      limit: z.number().int().min(1).max(500).default(100)
    }),
    outputSchema: z.object({
      updates: z.array(updateSchema),
      count: z.number().int()
    }),
    ui: {
      label: 'List updates',
      description: 'List patch updates Level reports for devices.',
      category: 'Level',
      icon: 'levelio'
    },
    handler: async (input, ctx) => {
      const { tenantId } = await requireLevelIntegration(ctx);
      const { createLevelWorkflowClient } = await loadLevelRuntimeSupport();
      const client = await createLevelWorkflowClient(tenantId);
      const updates = (await client.listUpdates({ deviceId: input.device_id, status: input.status }))
        .map((update) => normalizeLevelUpdate(update))
        .slice(0, input.limit ?? 100);
      return { updates, count: updates.length };
    }
  });

  registry.register({
    id: 'levelio.automations.list',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      query: z.string().trim().min(1).optional(),
      limit: z.number().int().min(1).max(200).default(50)
    }),
    outputSchema: z.object({
      automations: z.array(automationSchema),
      count: z.number().int()
    }),
    ui: {
      label: 'List automations',
      description: 'List Level automations with their webhook trigger tokens.',
      category: 'Level',
      icon: 'levelio'
    },
    handler: async (input, ctx) => {
      const { tenantId } = await requireLevelIntegration(ctx);
      const { createLevelWorkflowClient } = await loadLevelRuntimeSupport();
      const client = await createLevelWorkflowClient(tenantId);
      const [automations, webhooks] = await Promise.all([
        client.listAutomations(),
        client.listAutomationWebhooks()
      ]);
      const webhookByAutomationId = new Map<string, Record<string, unknown>>();
      for (const webhook of webhooks) {
        const automationId = asNullableString(webhook.automation_id);
        if (automationId) webhookByAutomationId.set(automationId, webhook);
      }

      const query = input.query?.toLowerCase();
      const normalized = automations
        .map((automation) => {
          const automationId = String(automation.id ?? '');
          const webhook = webhookByAutomationId.get(automationId);
          return {
            automation_id: automationId,
            name: asNullableString(automation.name),
            description: asNullableString(automation.description),
            group_id: asNullableString(automation.group_id),
            group_name: asNullableString(automation.group_name),
            webhook_token: webhook ? extractWebhookToken(webhook.url) : null,
            webhook_requires_authorization:
              webhook && typeof webhook.requires_authorization_header === 'boolean'
                ? webhook.requires_authorization_header
                : null
          };
        })
        .filter((automation) => !query || (automation.name ?? '').toLowerCase().includes(query))
        .slice(0, input.limit ?? 50);
      return { automations: normalized, count: normalized.length };
    }
  });

  registry.register({
    id: 'levelio.automations.trigger',
    version: 1,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      webhook_token: z.string().trim().min(1),
      device_ids: z.array(z.string().trim().min(1)).default([])
    }),
    outputSchema: z.object({
      triggered: z.boolean(),
      webhook_token: z.string(),
      vendor_response: z.unknown().nullable()
    }),
    ui: {
      label: 'Trigger automation',
      description: 'Trigger a Level automation via its webhook, optionally scoped to specific devices.',
      category: 'Level',
      icon: 'levelio'
    },
    handler: async (input, ctx) => {
      const { tenantId } = await requireLevelIntegration(ctx);
      const { createLevelWorkflowClient } = await loadLevelRuntimeSupport();
      const client = await createLevelWorkflowClient(tenantId);
      try {
        const vendorResponse = await client.triggerAutomationWebhook(input.webhook_token, input.device_ids ?? []);
        return { triggered: true, webhook_token: input.webhook_token, vendor_response: vendorResponse ?? null };
      } catch (error) {
        if (isLevelApiErrorWithStatus(error, 404)) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message:
              'Level webhook token not found. The automation needs a webhook trigger configured in Level; use "List automations" to discover tokens.'
          });
        }
        throw error;
      }
    }
  });

  registry.register({
    id: 'levelio.automations.run_status',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      run_id: z.string().trim().min(1),
      include_steps: z.boolean().default(false)
    }),
    outputSchema: z.object({
      run: runSchema,
      steps: z.unknown().nullable()
    }),
    ui: {
      label: 'Get automation run',
      description: 'Check the status of a Level automation run.',
      category: 'Level',
      icon: 'levelio'
    },
    handler: async (input, ctx) => {
      const { tenantId } = await requireLevelIntegration(ctx);
      const { createLevelWorkflowClient } = await loadLevelRuntimeSupport();
      const client = await createLevelWorkflowClient(tenantId);
      const run = await client.getAutomationRun(input.run_id, input.include_steps ?? false);
      return {
        run: normalizeLevelRun(run),
        steps: (input.include_steps ?? false) ? (run.steps ?? null) : null
      };
    }
  });

  levelRegistered = true;
}

export function registerLevelIoWorkflowModule(): void {
  registerIntegrationWorkflowModule({
    module: {
      groupKey: 'app:levelio',
      label: 'Level',
      description: 'Level (level.io) actions for devices, alerts, patching, and automations.',
      tileKind: 'app',
      iconToken: 'levelio',
      defaultActionId: 'levelio.devices.find',
      allowedActionIds: [
        'levelio.devices.find',
        'levelio.devices.get',
        'levelio.alerts.list_active',
        'levelio.alerts.resolve',
        'levelio.updates.list',
        'levelio.automations.list',
        'levelio.automations.trigger',
        'levelio.automations.run_status'
      ],
      availabilityKey: 'rmm:levelio'
    },
    availability: rmmIntegrationAvailability(PROVIDER),
    registerActions: () => registerLevelIoWorkflowActionsV2()
  });
}
