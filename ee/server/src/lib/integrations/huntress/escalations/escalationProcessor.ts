/**
 * Executes the planner's decisions for one Huntress escalation: one
 * rmm_alerts row and (when the plan says so) one ticket per organization the
 * escalation covers. Takes its Knex handle as a parameter so integration
 * tests run it on a real test database with no module mocks.
 */

import { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import { publishRmmTicketCreated } from '@alga-psa/shared/rmm/alerts';
import { ticketStatusClockPatch } from '@alga-psa/shared/lib/ticketStatusClock';
import { ticketUpdateStamp } from '@alga-psa/shared/lib/tickets/ticketUpdateStamp';
import type {
  HuntressAgent,
  HuntressEscalation,
  HuntressOrganization,
} from '../../../../interfaces/huntress.interfaces';
import type { HuntressSettings } from '../settings';
import type { HuntressIntegrationContext } from '../incidents/incidentProcessor';
import { addTicketInternalNote, createHuntressTicket } from '../incidents/ticketCreator';
import { matchAsset, resolveOrgMapping, upsertEntityMapping } from '../alertSupport';
import {
  escalationTargetPrefix,
  escalationTargets,
  parseEscalationTargetOrg,
  planEscalationAction,
  type EscalationAction,
  type EscalationTarget,
} from './escalationPlan';
import {
  agentsFromEntities,
  buildEscalationCreationNote,
  buildEscalationPortalUrl,
  buildEscalationTicketBody,
  buildEscalationTicketTitle,
  buildEscalationUpdateNote,
} from './escalationContent';

export interface ProcessEscalationDeps {
  getEscalation: (escalationId: number) => Promise<HuntressEscalation | null>;
  getAgent: (agentId: number) => Promise<HuntressAgent | null>;
  getOrganization: (orgId: number) => Promise<HuntressOrganization | null>;
}

export interface EscalationTargetResult {
  externalAlertId: string;
  action: EscalationAction['kind'];
  ticketId?: string;
}

export interface ProcessEscalationResult {
  ok: boolean;
  targets: EscalationTargetResult[];
  error?: string;
}

interface PlannedTarget {
  target: EscalationTarget;
  existingAlert: any;
  mapping: any;
  action: EscalationAction;
}

export async function processEscalation(
  knex: Knex,
  tenantId: string,
  integration: HuntressIntegrationContext,
  escalation: HuntressEscalation,
  deps: ProcessEscalationDeps
): Promise<ProcessEscalationResult> {
  const db = tenantDb(knex, tenantId);
  const results: EscalationTargetResult[] = [];

  try {
    // One query for every row this escalation has produced so far, so a
    // target that has since dropped off the escalation's org list still gets
    // its status notes and auto-close instead of being orphaned.
    const existingRows = await db.table('rmm_alerts')
      .where({ integration_id: integration.integration_id })
      .where('external_alert_id', 'like', `${escalationTargetPrefix(escalation.id)}%`);
    const existingByKey = new Map<string, any>(
      existingRows.map((row: any) => [row.external_alert_id, row])
    );

    // The org-less placeholder target is only for escalations that never
    // named an organization. If one that already has per-org rows comes back
    // with no orgs, those rows carry on as stale targets (notes, auto-close)
    // instead of a second ticket being opened on the fallback board.
    const currentTargets = escalationTargets(escalation).filter(
      (t) => t.organization !== null || existingRows.length === 0
    );
    const currentKeys = new Set(currentTargets.map((t) => t.externalAlertId));
    const staleTargets: EscalationTarget[] = existingRows
      .filter((row: any) => !currentKeys.has(row.external_alert_id))
      .map((row: any) => ({
        organization: parseEscalationTargetOrg(row.external_alert_id),
        externalAlertId: row.external_alert_id,
      }));

    const planned: PlannedTarget[] = [];
    for (const target of [...currentTargets, ...staleTargets]) {
      const existingAlert = existingByKey.get(target.externalAlertId) ?? null;
      // Mappings only matter for routing a new ticket.
      const mapping =
        !existingAlert && target.organization
          ? await resolveOrgMapping(knex, tenantId, {
              integrationId: integration.integration_id,
              organizationId: target.organization.id,
              organizationNameHint: target.organization.name,
              getOrganization: deps.getOrganization,
              discoveredVia: 'escalation_poll',
            })
          : null;
      const action = planEscalationAction({
        escalation,
        existingAlert,
        mapping: mapping ?? null,
        settings: integration.settings,
      });
      planned.push({ target, existingAlert, mapping, action });
    }

    // Entities (affected hosts/identities) only come from the detail
    // endpoint — fetch once, and only when a ticket is about to be created.
    // Entities aren't attributed to organizations, so a host is only used for
    // asset matching and device fields on a single-org escalation whose
    // complete entity list names exactly one agent; otherwise one client's
    // ticket could be linked to another client's same-named asset.
    let detailed = escalation;
    let agent: HuntressAgent | null = null;
    if (planned.some((p) => p.action.kind === 'create_ticket')) {
      const detail = await deps.getEscalation(escalation.id).catch(() => null);
      if (detail) detailed = { ...escalation, entities: detail.entities };
      const agents = agentsFromEntities(detailed);
      if (currentTargets.length === 1 && agents.length === 1 && !detailed.entities?.has_more) {
        agent = (await deps.getAgent(agents[0].id).catch(() => null)) ?? agents[0];
      }
    }

    const portalUrl = buildEscalationPortalUrl(
      integration.settings.accountSubdomain,
      escalation.id
    );
    const organizationIds = currentTargets
      .map((t) => t.organization?.id)
      .filter((id): id is number => id != null);

    for (const { target, existingAlert, mapping, action } of planned) {
      if (action.kind === 'skip') {
        results.push({ externalAlertId: target.externalAlertId, action: action.kind });
        continue;
      }

      let matchedAssetId: string | null = null;
      if (action.kind === 'create_ticket' && !action.unmapped && agent?.hostname) {
        matchedAssetId = await matchAsset(knex, tenantId, action.clientId, agent);
      }

      const organizationId = target.organization?.id ?? null;
      const now = new Date().toISOString();
      const alertColumns = {
        severity: escalation.severity,
        status: escalation.status,
        source_type: 'escalation',
        alert_class: escalation.type_code ?? null,
        message: escalation.subject ?? escalation.type ?? null,
        device_name: agent?.hostname ?? existingAlert?.device_name ?? null,
        external_device_id: agent ? String(agent.id) : existingAlert?.external_device_id ?? null,
        triggered_at: escalation.created_at ?? escalation.updated_at,
        resolved_at: escalation.resolved_at,
        metadata: JSON.stringify({
          kind: 'escalation',
          escalationId: escalation.id,
          type: escalation.type,
          typeCode: escalation.type_code,
          subtype: escalation.subtype,
          organizationId,
          organizationIds,
          psaTicketEids: escalation.psa_ticket_eids ?? [],
          portalUrl,
          lastProcessedUpdatedAt: escalation.updated_at,
        }),
        updated_at: now,
      };

      const ticketId = await withTransaction(knex, async (trx: Knex.Transaction) => {
        const txDb = tenantDb(trx, tenantId);
        let alertId: string;
        if (existingAlert) {
          alertId = existingAlert.alert_id;
          await txDb.table('rmm_alerts').where({ alert_id: alertId }).update(alertColumns);
        } else {
          const [inserted] = await txDb.table('rmm_alerts')
            .insert({
              tenant: tenantId,
              integration_id: integration.integration_id,
              external_alert_id: target.externalAlertId,
              asset_id: matchedAssetId,
              ...alertColumns,
            })
            .returning('alert_id');
          alertId = (inserted as { alert_id: string }).alert_id;
        }

        if (action.kind === 'create_ticket') {
          const severityKey = escalation.severity as keyof HuntressSettings['severityPriorityMap'];
          const ticket = await createHuntressTicket(trx, tenantId, {
            clientId: action.clientId,
            boardId: action.boardId,
            priorityId: integration.settings.severityPriorityMap[severityKey],
            categoryId: action.unmapped ? null : integration.settings.categoryId,
            subcategoryId: action.unmapped ? null : integration.settings.subcategoryId,
            title: buildEscalationTicketTitle(escalation, { unmapped: action.unmapped }),
            body: buildEscalationTicketBody(detailed, portalUrl, {
              unmapped: action.unmapped,
              organization: target.organization,
              orgName: mapping?.external_organization_name ?? undefined,
              agent,
            }),
            note: buildEscalationCreationNote(detailed),
            sourceReference: target.externalAlertId,
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
            await upsertEntityMapping(trx, tenantId, organizationId, agent, matchedAssetId);
          }
          return ticket.ticket_id;
        }

        if (action.kind === 'append_note' && existingAlert?.ticket_id) {
          await addTicketInternalNote(
            trx,
            tenantId,
            existingAlert.ticket_id,
            buildEscalationUpdateNote(action.previousStatus, escalation)
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

      results.push({ externalAlertId: target.externalAlertId, action: action.kind, ticketId });
    }

    return { ok: true, targets: results };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[Huntress] Failed to process escalation', {
      tenantId,
      escalationId: escalation.id,
      error: message,
    });
    // Targets committed before the failure stay committed; the cursor does
    // not advance, so the next cycle retries and the per-target dedup skips
    // them.
    return { ok: false, targets: results, error: message };
  }
}
