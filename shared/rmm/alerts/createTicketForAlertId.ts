import type { Knex } from 'knex';
import type { NormalizedRmmAlertEvent, RmmAlertRuleActions } from './contracts';
import { rmmAlertRuleActionsSchema } from './contracts';
import { createTicketForAlert, type CreatedAlertTicket } from './ticketCreator';

export interface CreateTicketForAlertIdArgs {
  tenantId: string;
  alertId: string;
  overrides?: Partial<
    Pick<RmmAlertRuleActions, 'boardId' | 'priorityOverride' | 'assignToUserId' | 'ticketTemplate'>
  >;
}

/**
 * Creates a ticket for an existing rmm_alerts row (manual button, workflow
 * action). Resolves the client from the asset, falling back to the
 * organization mapping, and links the alert to the created ticket.
 */
export async function createTicketForAlertId(
  knex: Knex,
  args: CreateTicketForAlertIdArgs
): Promise<CreatedAlertTicket> {
  const { tenantId, alertId } = args;

  const alert = await knex('rmm_alerts as a')
    .join('rmm_integrations as i', function joinIntegrations() {
      this.on('i.tenant', 'a.tenant').andOn('i.integration_id', 'a.integration_id');
    })
    .where('a.tenant', tenantId)
    .andWhere('a.alert_id', alertId)
    .first('a.*', 'i.provider');
  if (!alert) {
    throw new Error('Alert not found');
  }
  if (alert.ticket_id) {
    throw new Error('Alert already has a linked ticket');
  }

  let clientId: string | null = null;
  let organizationName: string | null = null;
  if (alert.asset_id) {
    const asset = await knex('assets')
      .where({ tenant: tenantId, asset_id: alert.asset_id })
      .first('client_id');
    clientId = asset?.client_id ?? null;
  }

  const rawMetadata = typeof alert.metadata === 'string' ? safeParse(alert.metadata) : alert.metadata;
  const externalOrgId =
    rawMetadata && typeof rawMetadata === 'object' && 'organizationId' in rawMetadata
      ? String((rawMetadata as Record<string, unknown>).organizationId)
      : null;
  if (externalOrgId) {
    const orgMapping = await knex('rmm_organization_mappings')
      .where({
        tenant: tenantId,
        integration_id: alert.integration_id,
        external_organization_id: externalOrgId,
      })
      .first('client_id', 'external_organization_name');
    organizationName = orgMapping?.external_organization_name ?? null;
    if (!clientId) clientId = orgMapping?.client_id ?? null;
  }
  if (!clientId) {
    throw new Error('No client resolvable for this alert (unmapped asset and organization)');
  }

  const event: NormalizedRmmAlertEvent = {
    tenantId,
    integrationId: alert.integration_id,
    provider: alert.provider,
    kind: 'triggered',
    externalAlertId: alert.external_alert_id,
    externalDeviceId: alert.external_device_id,
    activityType: alert.activity_type,
    alertClass: alert.alert_class,
    sourceType: alert.source_type,
    severity: alert.severity,
    message: alert.message,
    deviceName: alert.device_name,
    externalOrganizationId: externalOrgId,
    occurredAt: toIso(alert.triggered_at) ?? new Date().toISOString(),
    raw: (rawMetadata as Record<string, unknown>) ?? {},
  };
  const actions = rmmAlertRuleActionsSchema.parse({ createTicket: true, ...(args.overrides ?? {}) });

  return knex.transaction(async (trx) => {
    const created = await createTicketForAlert(trx, {
      event,
      actions,
      clientId: clientId!,
      assetId: alert.asset_id,
      organizationName,
    });
    await trx('rmm_alerts')
      .where({ tenant: tenantId, alert_id: alertId })
      .update({ ticket_id: created.ticket_id, updated_at: new Date().toISOString() });
    return created;
  });
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
