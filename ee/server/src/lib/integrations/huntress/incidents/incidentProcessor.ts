/**
 * Executes the planner's decision for one incident against the database.
 * Takes its Knex handle as a parameter so integration tests run it on a real
 * test database with no module mocks.
 */

import { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import { publishRmmTicketCreated } from '@alga-psa/shared/rmm/alerts';
import { ticketStatusClockPatch } from '@alga-psa/shared/lib/ticketStatusClock';
import { ticketUpdateStamp } from '@alga-psa/shared/lib/tickets/ticketUpdateStamp';
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
import { matchAsset, resolveOrgMapping, upsertEntityMapping } from '../alertSupport';

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
  const db = tenantDb(knex, tenantId);

  try {
    const existingAlert = await db.table('rmm_alerts')
      .where({
        integration_id: integration.integration_id,
        external_alert_id: externalAlertId,
      })
      .first();

    const mapping =
      incident.organization_id != null
        ? await resolveOrgMapping(knex, tenantId, {
            integrationId: integration.integration_id,
            organizationId: incident.organization_id,
            getOrganization: deps.getOrganization,
            discoveredVia: 'incident_poll',
          })
        : null;

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
      const txDb = tenantDb(trx, tenantId);
      let alertId: string;
      if (existingAlert) {
        alertId = existingAlert.alert_id;
        await txDb.table('rmm_alerts')
          .where({ alert_id: alertId })
          .update(alertColumns);
      } else {
        const [inserted] = await txDb.table('rmm_alerts')
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
          defaultContactId: action.unmapped ? null : mapping?.default_contact_id ?? null,
        });

        await txDb.table('rmm_alerts')
          .where({ alert_id: alertId })
          .update({ ticket_id: ticket.ticket_id, asset_id: matchedAssetId });

        await publishRmmTicketCreated({
          trx,
          tenantId,
          ticketId: ticket.ticket_id,
          source: 'huntress',
        });

        if (matchedAssetId && agent) {
          await upsertEntityMapping(trx, tenantId, incident.organization_id, agent, matchedAssetId);
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
          await txDb.table('tickets')
            .where({ ticket_id: existingAlert.ticket_id })
            .update({ status_id: integration.settings.closedStatusId, ...ticketStatusClockPatch(trx, integration.settings.closedStatusId), ...ticketUpdateStamp(trx, null) });
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
