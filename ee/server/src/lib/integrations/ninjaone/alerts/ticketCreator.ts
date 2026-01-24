/**
 * NinjaOne Alert Ticket Creator
 *
 * Creates tickets from RMM alerts with proper context, linking, and assignment.
 */

import { Knex } from 'knex';
import { createTenantKnex } from '@/lib/db';
import { withTransaction } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import { RmmAlert } from '../../../../interfaces/rmm.interfaces';

/**
 * Ticket data for creation
 */
export interface Ticket {
  ticket_id: string;
  tenant: string;
  ticket_number: string;
  title: string;
  client_id: string;
  status_id: string;
  priority_id?: string;
  channel_id?: string;
  assigned_to?: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Options for creating a ticket from an alert
 */
export interface CreateTicketFromAlertOptions {
  priority?: string;
  channelId?: string;
  assignToUserId?: string;
  notifyUsers?: string[];
  addToBoard?: string;
  customFields?: Record<string, unknown>;
  titlePrefix?: string;
  /** User who performed the action (for audit trail) */
  performedBy?: string;
}

/**
 * Create a ticket from an RMM alert
 */
export async function createTicketFromAlert(
  tenantId: string,
  alert: RmmAlert,
  options: CreateTicketFromAlertOptions = {}
): Promise<Ticket> {
  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Get asset details if linked
    let assetName = 'Unknown Device';
    let clientId: string | undefined;
    let assetLocation: string | undefined;

    if (alert.asset_id) {
      const asset = await trx('assets')
        .where({ tenant: tenantId, asset_id: alert.asset_id })
        .first();

      if (asset) {
        assetName = asset.name;
        clientId = asset.client_id;
        assetLocation = asset.location;
      }
    }

    // If no client from asset, try to get from organization mapping
    if (!clientId && alert.external_device_id) {
      const mapping = await trx('tenant_external_entity_mappings as teem')
        .join('rmm_organization_mappings as rom', function() {
          this.on('teem.external_realm_id', '=', 'rom.external_organization_id')
            .andOn('teem.tenant', '=', 'rom.tenant');
        })
        .where('teem.tenant', tenantId)
        .where('teem.external_entity_id', alert.external_device_id)
        .where('teem.integration_type', 'ninjaone')
        .first('rom.client_id');

      clientId = mapping?.client_id;
    }

    if (!clientId) {
      throw new Error('Cannot create ticket: No client associated with this alert');
    }

    // Get default status (usually "New" or "Open")
    const defaultStatus = await trx('statuses')
      .where({ tenant: tenantId, is_default: true })
      .first();

    if (!defaultStatus) {
      throw new Error('No default status configured');
    }

    // Get priority ID if specified
    let priorityId: string | undefined;
    if (options.priority) {
      const priority = await trx('priorities')
        .where({ tenant: tenantId })
        .whereRaw('LOWER(priority_name) = ?', [options.priority.toLowerCase()])
        .first();
      priorityId = priority?.priority_id;
    }

    // Generate ticket number
    const ticketNumber = await generateTicketNumber(trx, tenantId);

    // Build ticket title
    const titlePrefix = options.titlePrefix || '[NinjaOne Alert]';
    const title = `${titlePrefix} ${formatAlertTitle(alert, assetName)}`;

    // Build description with device context
    const description = buildTicketDescription(alert, assetName, assetLocation);

    // Create the ticket
    const now = new Date().toISOString();
    const [ticket] = await trx('tickets')
      .insert({
        tenant: tenantId,
        ticket_number: ticketNumber,
        title,
        client_id: clientId,
        status_id: defaultStatus.status_id,
        priority_id: priorityId,
        channel_id: options.channelId,
        assigned_to: options.assignToUserId,
        description,
        source: 'ninjaone',
        source_reference: alert.external_alert_id,
        created_at: now,
        updated_at: now,
      })
      .returning('*');

    // Link ticket to asset
    if (alert.asset_id) {
      await trx('asset_associations').insert({
        tenant: tenantId,
        asset_id: alert.asset_id,
        entity_id: ticket.ticket_id,
        entity_type: 'ticket',
        relationship_type: 'related',
        created_by: null, // System created
        created_at: now,
      });
    }

    // Add initial comment with alert details
    await trx('comments').insert({
      tenant: tenantId,
      ticket_id: ticket.ticket_id,
      user_id: null, // System comment
      comment_type: 'internal_note',
      comment: buildAlertDetailComment(alert),
      is_internal: true,
      created_at: now,
    });

    logger.info('Created ticket from NinjaOne alert', {
      tenantId,
      ticketId: ticket.ticket_id,
      ticketNumber,
      alertId: alert.alert_id,
      assetId: alert.asset_id,
    });

    return ticket as Ticket;
  });
}

/**
 * Generate a unique ticket number
 */
async function generateTicketNumber(
  trx: Knex.Transaction,
  tenantId: string
): Promise<string> {
  // Get the current max ticket number for this tenant
  const result = await trx('tickets')
    .where({ tenant: tenantId })
    .max('ticket_number as max_number')
    .first();

  // Parse the max number and increment
  let nextNumber = 1;
  if (result?.max_number) {
    const match = result.max_number.match(/(\d+)$/);
    if (match) {
      nextNumber = parseInt(match[1], 10) + 1;
    }
  }

  // Get ticket prefix from settings or use default
  const settings = await trx('tenant_settings')
    .where({ tenant: tenantId, setting_key: 'ticket_number_prefix' })
    .first();

  const prefix = settings?.setting_value || 'TKT-';

  return `${prefix}${String(nextNumber).padStart(6, '0')}`;
}

/**
 * Format alert title for ticket
 */
function formatAlertTitle(alert: RmmAlert, assetName: string): string {
  const activityType = formatActivityType(alert.activity_type);

  // Create a concise title
  if (alert.message && alert.message.length < 60) {
    return `${activityType} on ${assetName}: ${alert.message}`;
  }

  return `${activityType} on ${assetName}`;
}

/**
 * Format activity type for display
 */
function formatActivityType(activityType: string): string {
  // Convert SCREAMING_SNAKE_CASE to Title Case
  return activityType
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Build ticket description with context
 */
function buildTicketDescription(
  alert: RmmAlert,
  assetName: string,
  assetLocation?: string
): string {
  const lines: string[] = [];

  lines.push('## Alert Details');
  lines.push('');
  lines.push(`**Severity:** ${alert.severity}`);
  lines.push(`**Priority:** ${alert.priority}`);
  lines.push(`**Activity Type:** ${formatActivityType(alert.activity_type)}`);
  lines.push(`**Status:** ${alert.status}`);
  lines.push(`**Triggered At:** ${new Date(alert.triggered_at).toLocaleString()}`);
  lines.push('');

  if (alert.message) {
    lines.push('## Alert Message');
    lines.push('');
    lines.push(alert.message);
    lines.push('');
  }

  lines.push('## Device Information');
  lines.push('');
  lines.push(`**Device Name:** ${assetName}`);
  if (assetLocation) {
    lines.push(`**Location:** ${assetLocation}`);
  }
  lines.push(`**RMM Device ID:** ${alert.external_device_id}`);
  lines.push('');

  lines.push('---');
  lines.push('*This ticket was automatically created from a NinjaOne RMM alert.*');

  return lines.join('\n');
}

/**
 * Build detailed comment for alert
 */
function buildAlertDetailComment(alert: RmmAlert): string {
  const lines: string[] = [];

  lines.push('**Alert Created Automatically**');
  lines.push('');
  lines.push(`Alert ID: ${alert.external_alert_id}`);
  lines.push(`Severity: ${alert.severity}`);
  lines.push(`Priority: ${alert.priority}`);
  lines.push(`Activity Type: ${alert.activity_type}`);
  lines.push(`Triggered: ${new Date(alert.triggered_at).toISOString()}`);

  if (alert.source_data) {
    const sourceData = typeof alert.source_data === 'string'
      ? JSON.parse(alert.source_data)
      : alert.source_data;

    if (sourceData.sourceName) {
      lines.push(`Source: ${sourceData.sourceName}`);
    }
  }

  return lines.join('\n');
}

/**
 * Link an existing ticket to an alert
 */
export async function linkTicketToAlert(
  tenantId: string,
  alertId: string,
  ticketId: string
): Promise<void> {
  const { knex } = await createTenantKnex();
  const now = new Date().toISOString();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Update alert with ticket reference
    await trx('rmm_alerts')
      .where({ tenant: tenantId, alert_id: alertId })
      .update({
        ticket_id: ticketId,
        auto_ticket_created: false, // Manually linked
        updated_at: now,
      });

    // Get the alert to find asset ID
    const alert = await trx('rmm_alerts')
      .where({ tenant: tenantId, alert_id: alertId })
      .first();

    // Link ticket to asset if available
    if (alert?.asset_id) {
      // Check if association already exists
      const existing = await trx('asset_associations')
        .where({
          tenant: tenantId,
          asset_id: alert.asset_id,
          entity_id: ticketId,
          entity_type: 'ticket',
        })
        .first();

      if (!existing) {
        await trx('asset_associations').insert({
          tenant: tenantId,
          asset_id: alert.asset_id,
          entity_id: ticketId,
          entity_type: 'ticket',
          relationship_type: 'related',
          created_by: null,
          created_at: now,
        });
      }
    }
  });

  logger.info('Linked ticket to alert', { tenantId, alertId, ticketId });
}

/**
 * Create a ticket from an alert ID
 */
export async function createTicketFromAlertId(
  tenantId: string,
  alertId: string,
  options?: CreateTicketFromAlertOptions
): Promise<Ticket> {
  const { knex } = await createTenantKnex();

  // Get the alert
  const alert = await knex('rmm_alerts')
    .where({ tenant: tenantId, alert_id: alertId })
    .first() as RmmAlert;

  if (!alert) {
    throw new Error('Alert not found');
  }

  // Check if ticket already exists
  if (alert.ticket_id) {
    throw new Error('Alert already has a linked ticket');
  }

  return createTicketFromAlert(tenantId, alert, options);
}
