/**
 * Executes the planner's decision for one incident against the database.
 * Takes its Knex handle as a parameter so integration tests run it on a real
 * test database with no module mocks.
 */

import { Knex } from 'knex';
import { withTransaction } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import type {
  HuntressAgent,
  HuntressIncidentReport,
  HuntressOrganization,
} from '../../../../interfaces/huntress.interfaces';
import type { HuntressSettings } from '../settings';
import { planIncidentAction, type IncidentAction } from './incidentPlan';
import {
  buildCreationNote,
  buildPortalUrl,
  buildTicketBody,
  buildTicketTitle,
  buildUpdateNote,
} from './ticketContent';
import { addTicketInternalNote, createHuntressTicket } from './ticketCreator';

export interface ProcessIncidentDeps {
  getAgent: (agentId: number) => Promise<HuntressAgent | null>;
  getOrganization: (orgId: number) => Promise<HuntressOrganization | null>;
}

export interface ProcessIncidentResult {
  ok: boolean;
  action: IncidentAction['kind'] | 'error';
  ticketId?: string;
  error?: string;
}

export interface HuntressIntegrationContext {
  integration_id: string;
  settings: HuntressSettings;
}

export async function processIncident(
  knex: Knex,
  tenantId: string,
  integration: HuntressIntegrationContext,
  incident: HuntressIncidentReport,
  deps: ProcessIncidentDeps
): Promise<ProcessIncidentResult> {
  const externalAlertId = String(incident.id);

  try {
    const existingAlert = await knex('rmm_alerts')
      .where({
        tenant: tenantId,
        integration_id: integration.integration_id,
        external_alert_id: externalAlertId,
      })
      .first();

    let mapping =
      incident.organization_id != null
        ? await knex('rmm_organization_mappings')
            .where({
              tenant: tenantId,
              integration_id: integration.integration_id,
              external_organization_id: String(incident.organization_id),
            })
            .first()
        : null;

    // Org created in Huntress after the last org sync: discover it on demand
    // so the mapping screen stays current, then fall through to fallback
    // routing (the new row is unmapped).
    if (!mapping && incident.organization_id != null) {
      const org = await deps
        .getOrganization(incident.organization_id)
        .catch(() => null);
      const [inserted] = await knex('rmm_organization_mappings')
        .insert({
          tenant: tenantId,
          mapping_id: knex.raw('gen_random_uuid()'),
          integration_id: integration.integration_id,
          external_organization_id: String(incident.organization_id),
          external_organization_name: org?.name ?? `Huntress org ${incident.organization_id}`,
          client_id: null,
          auto_sync_assets: false,
          auto_create_tickets: true,
          metadata: JSON.stringify({ discoveredVia: 'incident_poll' }),
        })
        .onConflict(['tenant', 'integration_id', 'external_organization_id'])
        .ignore()
        .returning('*');
      mapping =
        inserted ??
        (await knex('rmm_organization_mappings')
          .where({
            tenant: tenantId,
            integration_id: integration.integration_id,
            external_organization_id: String(incident.organization_id),
          })
          .first());
    }

    const action = planIncidentAction({
      incident,
      existingAlert: existingAlert ?? null,
      mapping: mapping ?? null,
      settings: integration.settings,
    });

    if (action.kind === 'skip') {
      return { ok: true, action: action.kind };
    }

    // Agent details and asset match are fetched outside the transaction
    // (API call + read-only query).
    let agent: HuntressAgent | null = null;
    let matchedAssetId: string | null = null;
    if (action.kind === 'create_ticket' && incident.agent_id != null) {
      agent = await deps.getAgent(incident.agent_id).catch(() => null);
      if (!action.unmapped && agent?.hostname) {
        matchedAssetId = await matchAsset(knex, tenantId, action.clientId, agent);
      }
    }

    const portalUrl = buildPortalUrl(integration.settings.accountSubdomain, incident.id);
    const now = new Date().toISOString();
    const alertColumns = {
      severity: incident.severity,
      status: incident.status,
      message: incident.subject ?? null,
      device_name: agent?.hostname ?? existingAlert?.device_name ?? null,
      external_device_id: incident.agent_id != null ? String(incident.agent_id) : null,
      triggered_at: incident.sent_at ?? incident.updated_at,
      resolved_at: incident.closed_at,
      metadata: JSON.stringify({
        summary: incident.summary,
        platform: incident.platform,
        indicatorTypes: incident.indicator_types,
        indicatorCounts: incident.indicator_counts,
        organizationId: incident.organization_id,
        portalUrl,
        statusUpdatedAt: incident.status_updated_at,
        lastProcessedUpdatedAt: incident.updated_at,
      }),
      updated_at: now,
    };

    const ticketId = await withTransaction(knex, async (trx: Knex.Transaction) => {
      let alertId: string;
      if (existingAlert) {
        alertId = existingAlert.alert_id;
        await trx('rmm_alerts')
          .where({ tenant: tenantId, alert_id: alertId })
          .update(alertColumns);
      } else {
        const [inserted] = await trx('rmm_alerts')
          .insert({
            tenant: tenantId,
            integration_id: integration.integration_id,
            external_alert_id: externalAlertId,
            asset_id: matchedAssetId,
            ...alertColumns,
          })
          .returning('alert_id');
        alertId = (inserted as { alert_id: string }).alert_id;
      }

      if (action.kind === 'create_ticket') {
        const severityKey = incident.severity as keyof HuntressSettings['severityPriorityMap'];
        const ticket = await createHuntressTicket(trx, tenantId, {
          clientId: action.clientId,
          boardId: action.boardId,
          priorityId: integration.settings.severityPriorityMap[severityKey],
          categoryId: action.unmapped ? null : integration.settings.categoryId,
          subcategoryId: action.unmapped ? null : integration.settings.subcategoryId,
          title: buildTicketTitle(incident, { unmapped: action.unmapped }),
          body: buildTicketBody(incident, agent, portalUrl, {
            unmapped: action.unmapped,
            orgName: mapping?.external_organization_name ?? undefined,
          }),
          note: buildCreationNote(incident),
          sourceReference: externalAlertId,
          assetId: matchedAssetId,
        });

        await trx('rmm_alerts')
          .where({ tenant: tenantId, alert_id: alertId })
          .update({ ticket_id: ticket.ticket_id, asset_id: matchedAssetId });

        if (matchedAssetId && agent) {
          await upsertEntityMapping(trx, tenantId, incident, agent, matchedAssetId);
        }
        return ticket.ticket_id;
      }

      if (action.kind === 'append_note' && existingAlert?.ticket_id) {
        await addTicketInternalNote(
          trx,
          tenantId,
          existingAlert.ticket_id,
          buildUpdateNote(action.previousStatus, incident)
        );
        if (action.close && integration.settings.closedStatusId) {
          await trx('tickets')
            .where({ tenant: tenantId, ticket_id: existingAlert.ticket_id })
            .update({ status_id: integration.settings.closedStatusId, updated_at: now });
        }
        return existingAlert.ticket_id as string;
      }

      return undefined;
    });

    return { ok: true, action: action.kind, ticketId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[Huntress] Failed to process incident', {
      tenantId,
      incidentId: incident.id,
      error: message,
    });
    return { ok: false, action: 'error', error: message };
  }
}

/** Unique hostname match within the mapped client; serial number tie-breaks. */
async function matchAsset(
  knex: Knex,
  tenantId: string,
  clientId: string,
  agent: HuntressAgent
): Promise<string | null> {
  const candidates = await knex('assets')
    .where({ tenant: tenantId, client_id: clientId })
    .whereRaw('LOWER(name) = ?', [String(agent.hostname).toLowerCase()])
    .select('asset_id', 'serial_number');

  if (candidates.length === 1) return candidates[0].asset_id;
  if (candidates.length > 1 && agent.serial_number) {
    const bySerial = candidates.filter((c) => c.serial_number === agent.serial_number);
    if (bySerial.length === 1) return bySerial[0].asset_id;
  }
  return null;
}

async function upsertEntityMapping(
  trx: Knex.Transaction,
  tenantId: string,
  incident: HuntressIncidentReport,
  agent: HuntressAgent,
  assetId: string
): Promise<void> {
  const existing = await trx('tenant_external_entity_mappings')
    .where({
      tenant: tenantId,
      integration_type: 'huntress',
      external_entity_id: String(agent.id),
    })
    .first();
  if (existing) {
    await trx('tenant_external_entity_mappings')
      .where({ id: existing.id })
      .update({
        alga_entity_id: assetId,
        sync_status: 'synced',
        last_synced_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
    return;
  }
  await trx('tenant_external_entity_mappings').insert({
    tenant: tenantId,
    integration_type: 'huntress',
    alga_entity_type: 'asset',
    alga_entity_id: assetId,
    external_entity_id: String(agent.id),
    external_realm_id:
      incident.organization_id != null ? String(incident.organization_id) : null,
    sync_status: 'synced',
    last_synced_at: trx.fn.now(),
    metadata: JSON.stringify({ hostname: agent.hostname }),
  });
}
