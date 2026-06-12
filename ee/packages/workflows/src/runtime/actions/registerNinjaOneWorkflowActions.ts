import { z } from 'zod';
import { getActionRegistryV2 } from '../../../../../../shared/workflow/runtime/registries/actionRegistry';
import { throwActionError } from '../../../../../../shared/workflow/runtime/actions/businessOperations/shared';
import type { ActionContext } from '../../../../../../shared/workflow/runtime/registries/actionRegistry';
import { registerIntegrationWorkflowModule, rmmIntegrationAvailability } from '../integrationModules';

const loadNinjaOneRuntimeSupport = () => import('./ninjaOneWorkflowRuntimeSupport');

const deviceSchema = z.object({
  external_device_id: z.string(),
  asset_id: z.string().uuid().nullable(),
  organization_id: z.string().nullable(),
  hostname: z.string().nullable(),
  display_name: z.string().nullable(),
  dns_name: z.string().nullable(),
  agent_online: z.boolean(),
  last_seen_at: z.string().nullable(),
  os_name: z.string().nullable(),
  node_class: z.string().nullable(),
  source: z.enum(['local', 'ninjaone'])
});

const alertSchema = z.object({
  alert_id: z.string(),
  external_alert_id: z.string(),
  status: z.string().nullable(),
  severity: z.string().nullable(),
  priority: z.string().nullable(),
  title: z.string().nullable(),
  message: z.string().nullable(),
  device_id: z.string().nullable(),
  asset_id: z.string().uuid().nullable(),
  source_type: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  acknowledged: z.boolean()
});

const ninjaOneDeviceIdSchema = z.coerce.number().int().positive();

const toNullableIsoString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return String(value);
};

async function requireNinjaOneIntegration(ctx: ActionContext): Promise<{
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

  const integration = await knex('rmm_integrations')
    .where({ tenant: tenantId, provider: 'ninjaone', is_active: true })
    .whereNotNull('connected_at')
    .first();
  if (!integration) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'INTEGRATION_INACTIVE',
      message: 'NinjaOne integration is not active for this tenant'
    });
  }

  return {
    tenantId,
    knex,
    integrationId: String(integration.integration_id),
  };
}

const normalizeNinjaDevice = (device: any, source: 'local' | 'ninjaone') => {
  const agentStatus = typeof device.agent_status === 'string' ? device.agent_status.toLowerCase() : null;
  const agentOnline = typeof device.offline === 'boolean'
    ? !device.offline
    : agentStatus
      ? agentStatus === 'online'
      : true;

  return {
    external_device_id: String(device.id ?? device.rmm_device_id ?? ''),
    asset_id: device.asset_id ?? null,
    organization_id: device.organizationId ? String(device.organizationId) : (device.rmm_organization_id ?? null),
    hostname: device.systemName ?? null,
    display_name: device.displayName ?? device.name ?? null,
    dns_name: device.dnsName ?? null,
    agent_online: agentOnline,
    last_seen_at: toNullableIsoString(device.lastContact ?? device.last_seen_at),
    os_name: device.os?.name ?? null,
    node_class: device.nodeClass ?? null,
    source
  };
};

const normalizeNinjaAlert = (alert: any) => ({
  alert_id: String(alert.alert_id ?? alert.uid ?? ''),
  external_alert_id: String(alert.external_alert_id ?? alert.uid ?? ''),
  status: alert.status ?? 'active',
  severity: alert.severity ?? null,
  priority: alert.priority ?? null,
  title: alert.sourceName ?? alert.alert_class ?? null,
  message: alert.message ?? null,
  device_id: alert.external_device_id ? String(alert.external_device_id) : (alert.deviceId ? String(alert.deviceId) : null),
  asset_id: alert.asset_id ?? null,
  source_type: alert.source_type ?? alert.sourceType ?? null,
  created_at: toNullableIsoString(alert.triggered_at ?? alert.createTime),
  updated_at: toNullableIsoString(alert.updated_at ?? alert.updateTime),
  acknowledged: String(alert.status ?? '').toLowerCase() === 'acknowledged'
});

let ninjaOneRegistered = false;

export function registerNinjaOneWorkflowActionsV2(): void {
  if (ninjaOneRegistered) return;
  const registry = getActionRegistryV2();

  registry.register({
    id: 'ninjaone.devices.find',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      device_id: ninjaOneDeviceIdSchema.optional(),
      asset_id: z.string().uuid().optional(),
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
      description: 'Find NinjaOne devices from synced records and optional live API lookup.',
      category: 'NinjaOne',
      icon: 'ninjaone'
    },
    handler: async (input, ctx) => {
      const { tenantId, knex, integrationId } = await requireNinjaOneIntegration(ctx);
      let rows = await knex('assets')
        .where({ tenant: tenantId, rmm_provider: 'ninjaone' })
        .whereNotNull('rmm_device_id')
        .modify((qb: any) => {
          if (input.asset_id) qb.andWhere('asset_id', input.asset_id);
          if (input.device_id !== undefined) qb.andWhere('rmm_device_id', String(input.device_id));
          if (input.query) {
            qb.andWhere((inner: any) => {
              inner
                .whereILike('name', `%${input.query}%`)
                .orWhereILike('asset_tag', `%${input.query}%`)
                .orWhereILike('serial_number', `%${input.query}%`);
            });
          }
        })
        .limit(input.limit);

      const localDevices = rows.map((row: any) => normalizeNinjaDevice(row, 'local'));
      if (!input.live) {
        return { devices: localDevices, count: localDevices.length };
      }

      const { createNinjaOneWorkflowClient } = await loadNinjaOneRuntimeSupport();
      const client = await createNinjaOneWorkflowClient(tenantId, integrationId);
      const liveDeviceRows = input.device_id !== undefined
        ? [await client.getDevice(input.device_id)]
        : input.asset_id && localDevices[0]?.external_device_id
          ? [await client.getDevice(Number(localDevices[0].external_device_id))]
          : await client.getDevices({ pageSize: input.limit, ...(input.query ? { df: input.query } : {}) });
      const liveDevices = liveDeviceRows.map((device) => normalizeNinjaDevice(device, 'ninjaone'));
      return { devices: liveDevices, count: liveDevices.length };
    }
  });

  registry.register({
    id: 'ninjaone.devices.sync',
    version: 1,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      device_id: ninjaOneDeviceIdSchema
    }),
    outputSchema: z.object({
      synced: z.boolean(),
      external_device_id: z.string(),
      asset_id: z.string().uuid().nullable()
    }),
    ui: {
      label: 'Sync device',
      description: 'Sync a single NinjaOne device into Alga assets.',
      category: 'NinjaOne',
      icon: 'ninjaone'
    },
    handler: async (input, ctx) => {
      const { tenantId, integrationId } = await requireNinjaOneIntegration(ctx);
      const { syncNinjaOneDevice } = await loadNinjaOneRuntimeSupport();
      const asset = await syncNinjaOneDevice({
        tenantId,
        integrationId,
        deviceId: input.device_id,
      });
      return {
        synced: true,
        external_device_id: String(input.device_id),
        asset_id: asset?.asset_id ?? null
      };
    }
  });

  registry.register({
    id: 'ninjaone.devices.reboot',
    version: 1,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      device_id: ninjaOneDeviceIdSchema
    }),
    outputSchema: z.object({
      reboot_requested: z.boolean(),
      external_device_id: z.string()
    }),
    ui: {
      label: 'Reboot device',
      description: 'Send a reboot command to a NinjaOne device.',
      category: 'NinjaOne',
      icon: 'ninjaone'
    },
    handler: async (input, ctx) => {
      const { tenantId, integrationId } = await requireNinjaOneIntegration(ctx);
      const { createNinjaOneWorkflowClient } = await loadNinjaOneRuntimeSupport();
      const client = await createNinjaOneWorkflowClient(tenantId, integrationId);
      await client.rebootDevice(input.device_id);
      return { reboot_requested: true, external_device_id: String(input.device_id) };
    }
  });

  registry.register({
    id: 'ninjaone.alerts.list_active',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      limit: z.number().int().min(1).max(200).default(50),
      live: z.boolean().default(false)
    }),
    outputSchema: z.object({
      alerts: z.array(alertSchema),
      count: z.number().int()
    }),
    ui: {
      label: 'List active alerts',
      description: 'List active NinjaOne alerts for downstream workflow mapping.',
      category: 'NinjaOne',
      icon: 'ninjaone'
    },
    handler: async (input, ctx) => {
      const { tenantId, knex, integrationId } = await requireNinjaOneIntegration(ctx);
      if (!input.live) {
        const rows = await knex('rmm_alerts')
          .where({ tenant: tenantId, integration_id: integrationId, status: 'active' })
          .orderBy('triggered_at', 'desc')
          .limit(input.limit);
        const alerts = rows.map((row: any) => normalizeNinjaAlert(row));
        return { alerts, count: alerts.length };
      }

      const { createNinjaOneWorkflowClient } = await loadNinjaOneRuntimeSupport();
      const client = await createNinjaOneWorkflowClient(tenantId, integrationId);
      const alerts = (await client.getAlerts({ pageSize: input.limit })).map((alert) => normalizeNinjaAlert(alert));
      return { alerts, count: alerts.length };
    }
  });

  registry.register({
    id: 'ninjaone.alerts.get',
    version: 1,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      alert_uid: z.string().optional(),
      external_alert_id: z.string().optional()
    }).refine((value) => Boolean(value.alert_uid || value.external_alert_id), {
      message: 'alert_uid or external_alert_id is required'
    }),
    outputSchema: z.object({
      alert: alertSchema
    }),
    ui: {
      label: 'Get alert',
      description: 'Get one NinjaOne alert by external alert ID or alert UID.',
      category: 'NinjaOne',
      icon: 'ninjaone'
    },
    handler: async (input, ctx) => {
      const { tenantId, knex, integrationId } = await requireNinjaOneIntegration(ctx);
      const externalId = input.external_alert_id ?? input.alert_uid;
      const row = await knex('rmm_alerts')
        .where({ tenant: tenantId, integration_id: integrationId, external_alert_id: externalId })
        .first();
      if (!row) {
        throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Alert not found' });
      }
      return { alert: normalizeNinjaAlert(row) };
    }
  });

  registry.register({
    id: 'ninjaone.alerts.reset',
    version: 1,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    inputSchema: z.object({
      alert_uid: z.string().optional(),
      external_alert_id: z.string().optional()
    }).refine((value) => Boolean(value.alert_uid || value.external_alert_id), {
      message: 'alert_uid or external_alert_id is required'
    }),
    outputSchema: z.object({
      acknowledged: z.boolean(),
      alert_id: z.string()
    }),
    ui: {
      label: 'Acknowledge alert',
      description: 'Acknowledge an alert using NinjaOne reset alert operation.',
      category: 'NinjaOne',
      icon: 'ninjaone'
    },
    handler: async (input, ctx) => {
      const { tenantId, knex, integrationId } = await requireNinjaOneIntegration(ctx);
      const alertId = input.alert_uid ?? input.external_alert_id!;
      const { createNinjaOneWorkflowClient } = await loadNinjaOneRuntimeSupport();
      const client = await createNinjaOneWorkflowClient(tenantId, integrationId);
      await client.resetAlert(alertId);
      await knex('rmm_alerts')
        .where({ tenant: tenantId, integration_id: integrationId, external_alert_id: alertId })
        .update({ status: 'acknowledged', updated_at: new Date().toISOString() });
      return {
        acknowledged: true,
        alert_id: alertId
      };
    }
  });

  ninjaOneRegistered = true;
}

export function registerNinjaOneWorkflowModule(): void {
  registerIntegrationWorkflowModule({
    module: {
      groupKey: 'app:ninjaone',
      label: 'NinjaOne',
      description: 'NinjaOne RMM actions for devices and alerts.',
      tileKind: 'app',
      iconToken: 'ninjaone',
      defaultActionId: 'ninjaone.devices.find',
      allowedActionIds: [
        'ninjaone.devices.find',
        'ninjaone.devices.sync',
        'ninjaone.devices.reboot',
        'ninjaone.alerts.list_active',
        'ninjaone.alerts.get',
        'ninjaone.alerts.reset'
      ],
      availabilityKey: 'rmm:ninjaone'
    },
    availability: rmmIntegrationAvailability('ninjaone'),
    registerActions: () => registerNinjaOneWorkflowActionsV2()
  });
}
