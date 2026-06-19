import type { Knex } from 'knex';
import type {
  NormalizedRmmAlertEvent,
  RmmAlertProcessingContext,
  RmmAlertProcessingResult,
  RmmAlertRuleActions,
  RmmAlertRuleRow,
  RmmMaintenanceWindowRow,
} from './contracts';
import { rmmAlertRuleActionsSchema } from './contracts';
import { computeDedupKey } from './dedupKey';
import { evaluateAlertRules } from './ruleEvaluator';
import { findMatchingWindow } from './windowMatcher';
import { addAlertInternalNote, createTicketForAlert, providerLabel } from './ticketCreator';
import { publishRmmTicketCreated } from './ticketCreatedEvent';
import { isTicketUntouched } from './untouched';

/**
 * Single entry point for normalized RMM alert events (webhooks and the
 * reconciliation poller). All ingest work is local DB writes inside one
 * transaction; workflow events and notifications publish after commit.
 * Replayed deliveries are no-ops, so at-least-once sources are safe.
 */
export interface ProcessRmmAlertEventOptions {
  /**
   * Reconciliation passes this so a still-active suppressed alert re-enters
   * the pipeline once its maintenance window has ended (the window check runs
   * again against the event's occurredAt).
   */
  reprocessSuppressed?: boolean;
}

export async function processRmmAlertEvent(
  ctx: RmmAlertProcessingContext,
  event: NormalizedRmmAlertEvent,
  options: ProcessRmmAlertEventOptions = {}
): Promise<RmmAlertProcessingResult> {
  switch (event.kind) {
    case 'triggered':
      return processTriggered(ctx, event, options);
    case 'reset':
      return processReset(ctx, event);
    case 'acknowledged':
      return processAcknowledged(ctx, event);
  }
}

interface ResolvedAlertContext {
  assetId: string | null;
  clientId: string | null;
  organizationName: string | null;
  mappingDefaultContactId: string | null;
}

async function resolveAlertContext(knex: Knex, event: NormalizedRmmAlertEvent): Promise<ResolvedAlertContext> {
  let assetId: string | null = null;
  let clientId: string | null = null;
  let organizationName: string | null = null;
  let mappingDefaultContactId: string | null = null;

  if (event.externalDeviceId) {
    const mapping = await knex('tenant_external_entity_mappings')
      .where({
        tenant: event.tenantId,
        integration_type: event.provider,
        alga_entity_type: 'asset',
        external_entity_id: event.externalDeviceId,
      })
      .first('alga_entity_id');
    if (mapping?.alga_entity_id) {
      const asset = await knex('assets')
        .where({ tenant: event.tenantId, asset_id: mapping.alga_entity_id })
        .first('asset_id', 'client_id');
      if (asset) {
        assetId = asset.asset_id;
        clientId = asset.client_id ?? null;
      }
    }
  }

  if (event.externalOrganizationId) {
    const orgMapping = await knex('rmm_organization_mappings')
      .where({
        tenant: event.tenantId,
        integration_id: event.integrationId,
        external_organization_id: event.externalOrganizationId,
      })
      .first('client_id', 'external_organization_name', 'default_contact_id');
    organizationName = orgMapping?.external_organization_name ?? null;
    mappingDefaultContactId = orgMapping?.default_contact_id ?? null;
    if (!clientId) clientId = orgMapping?.client_id ?? null;
  }

  return { assetId, clientId, organizationName, mappingDefaultContactId };
}

async function processTriggered(
  ctx: RmmAlertProcessingContext,
  event: NormalizedRmmAlertEvent,
  options: ProcessRmmAlertEventOptions = {}
): Promise<RmmAlertProcessingResult> {
  const { knex, deps } = ctx;
  const warnings: string[] = [];
  const context = await resolveAlertContext(knex, event);
  const dedupKey = computeDedupKey(event);

  const result = await knex.transaction(async (trx): Promise<RmmAlertProcessingResult> => {
    const existing = await trx('rmm_alerts')
      .where({
        tenant: event.tenantId,
        integration_id: event.integrationId,
        external_alert_id: event.externalAlertId,
      })
      .first('alert_id', 'status', 'ticket_id');

    // Same external alert in a live state again = redelivery; nothing to do.
    // Suppressed alerts fall through when reconciliation reprocesses them.
    const duplicateStatuses = options.reprocessSuppressed
      ? ['active', 'acknowledged']
      : ['active', 'acknowledged', 'suppressed'];
    if (existing && duplicateStatuses.includes(existing.status)) {
      await trx('rmm_alerts')
        .where({ tenant: event.tenantId, alert_id: existing.alert_id })
        .update({ updated_at: new Date().toISOString() });
      return {
        outcome: 'skipped',
        alertId: existing.alert_id,
        ticketId: existing.ticket_id ?? null,
        warnings,
      };
    }

    const baseRow = {
      tenant: event.tenantId,
      integration_id: event.integrationId,
      external_alert_id: event.externalAlertId,
      external_device_id: event.externalDeviceId ?? null,
      asset_id: context.assetId,
      severity: event.severity,
      status: 'active',
      source_type: event.sourceType ?? null,
      alert_class: event.alertClass ?? null,
      activity_type: event.activityType ?? null,
      message: event.message ?? null,
      device_name: event.deviceName ?? null,
      dedup_key: dedupKey,
      triggered_at: event.occurredAt,
      last_occurrence_at: event.occurredAt,
      metadata: JSON.stringify(event.raw),
      updated_at: new Date().toISOString(),
    };

    let alertId: string;
    if (existing) {
      // A previously-resolved alert id re-triggering re-enters the pipeline.
      alertId = existing.alert_id;
      await trx('rmm_alerts')
        .where({ tenant: event.tenantId, alert_id: alertId })
        .update({ ...baseRow, ticket_id: null, resolved_at: null, suppressed_by_window_id: null });
    } else {
      const inserted = await trx('rmm_alerts')
        .insert({ ...baseRow, created_at: new Date().toISOString() })
        .returning(['alert_id']);
      alertId = inserted[0].alert_id;
    }

    // Maintenance windows suppress before any rule work.
    const windows = (await trx('rmm_maintenance_windows')
      .where({ tenant: event.tenantId, is_active: true })) as RmmMaintenanceWindowRow[];
    const matchedWindow = findMatchingWindow(windows, {
      integrationId: event.integrationId,
      clientId: context.clientId,
      assetId: context.assetId,
      occurredAt: event.occurredAt,
    });
    if (matchedWindow) {
      await trx('rmm_alerts')
        .where({ tenant: event.tenantId, alert_id: alertId })
        .update({ status: 'suppressed', suppressed_by_window_id: matchedWindow.window_id });
      return {
        outcome: 'suppressed',
        alertId,
        suppressedByWindowId: matchedWindow.window_id,
        warnings,
      };
    }

    const rules = (await trx('rmm_alert_rules')
      .where({ tenant: event.tenantId, integration_id: event.integrationId, is_active: true })
      .orderBy('priority_order', 'asc')) as RmmAlertRuleRow[];
    const evaluation = evaluateAlertRules(rules, event);
    warnings.push(...evaluation.warnings);

    if (evaluation.rule) {
      await trx('rmm_alerts')
        .where({ tenant: event.tenantId, alert_id: alertId })
        .update({ matched_rule_id: evaluation.rule.rule_id });
    }

    const actions = parseActions(evaluation.rule, warnings);
    if (!evaluation.rule || !actions || !actions.createTicket) {
      return { outcome: 'recorded_only', alertId, matchedRuleId: evaluation.rule?.rule_id ?? null, warnings };
    }

    // Dedup: an open ticket for the same (device, condition) absorbs this alert.
    const sibling = await trx('rmm_alerts as a')
      .join('tickets as t', function joinTickets() {
        this.on('t.tenant', 'a.tenant').andOn('t.ticket_id', 'a.ticket_id');
      })
      .join('statuses as s', function joinStatuses() {
        this.on('s.tenant', 't.tenant').andOn('s.status_id', 't.status_id');
      })
      .where('a.tenant', event.tenantId)
      .andWhere('a.integration_id', event.integrationId)
      .andWhere('a.dedup_key', dedupKey)
      .andWhereNot('a.alert_id', alertId)
      .whereNotNull('a.ticket_id')
      .andWhere('s.is_closed', false)
      // Oldest sibling = the row that created the ticket; it carries the
      // authoritative occurrence_count (newer siblings are absorbed copies).
      .orderBy('a.created_at', 'asc')
      .first('a.alert_id as sibling_alert_id', 'a.ticket_id', 'a.occurrence_count');

    if (sibling?.ticket_id) {
      const occurrence = Number(sibling.occurrence_count ?? 1) + 1;
      await trx('rmm_alerts')
        .where({ tenant: event.tenantId, alert_id: alertId })
        .update({ ticket_id: sibling.ticket_id });
      await trx('rmm_alerts')
        .where({ tenant: event.tenantId, alert_id: sibling.sibling_alert_id })
        .update({ occurrence_count: occurrence, last_occurrence_at: event.occurredAt });
      await addAlertInternalNote(
        trx,
        event.tenantId,
        sibling.ticket_id,
        `Alert re-triggered — occurrence ${occurrence}.\nExternal alert ID: ${event.externalAlertId}\n${event.message ?? ''}`.trim()
      );
      return {
        outcome: 'occurrence_appended',
        alertId,
        ticketId: sibling.ticket_id,
        matchedRuleId: evaluation.rule.rule_id,
        warnings,
      };
    }

    if (!context.clientId) {
      warnings.push('No client resolvable for alert (unmapped asset and organization); alert recorded without ticket');
      return { outcome: 'recorded_only', alertId, matchedRuleId: evaluation.rule.rule_id, warnings };
    }

    const ticket = await createTicketForAlert(trx, {
      event,
      actions,
      clientId: context.clientId,
      assetId: context.assetId,
      organizationName: context.organizationName,
      mappingDefaultContactId: context.mappingDefaultContactId,
    });
    await trx('rmm_alerts')
      .where({ tenant: event.tenantId, alert_id: alertId })
      .update({ ticket_id: ticket.ticket_id, auto_ticket_created: true });

    return {
      outcome: 'ticket_created',
      alertId,
      ticketId: ticket.ticket_id,
      matchedRuleId: evaluation.rule.rule_id,
      warnings,
    };
  });

  if (result.outcome !== 'suppressed' && result.outcome !== 'skipped') {
    await publishSafely(ctx, 'RMM_ALERT_TRIGGERED', event, result, context.assetId);
    if (result.outcome === 'ticket_created' && result.ticketId) {
      await publishRmmTicketCreated({
        tenantId: event.tenantId,
        ticketId: result.ticketId,
        source: event.provider,
      });
    }
    if (result.outcome === 'ticket_created' && result.matchedRuleId) {
      await notifySafely(ctx, event, result, context.assetId);
    }
  }

  return result;
}

async function processReset(
  ctx: RmmAlertProcessingContext,
  event: NormalizedRmmAlertEvent
): Promise<RmmAlertProcessingResult> {
  const { knex } = ctx;
  const warnings: string[] = [];
  let resolvedQuietly = false;
  let resolvedAssetId: string | null = null;

  const result = await knex.transaction(async (trx): Promise<RmmAlertProcessingResult> => {
    const existing = await trx('rmm_alerts')
      .where({
        tenant: event.tenantId,
        integration_id: event.integrationId,
        external_alert_id: event.externalAlertId,
      })
      .first('alert_id', 'status', 'ticket_id', 'matched_rule_id', 'asset_id');

    if (!existing || existing.status === 'resolved' || existing.status === 'auto_resolved') {
      return { outcome: 'skipped', alertId: existing?.alert_id, warnings };
    }
    resolvedAssetId = existing.asset_id ?? null;

    const wasSuppressed = existing.status === 'suppressed';
    await trx('rmm_alerts').where({ tenant: event.tenantId, alert_id: existing.alert_id }).update({
      status: 'resolved',
      resolved_at: event.occurredAt,
      updated_at: new Date().toISOString(),
    });

    // Suppressed alerts resolve quietly: no ticket exists and no events fire.
    if (wasSuppressed) {
      resolvedQuietly = true;
      return { outcome: 'resolved', alertId: existing.alert_id, warnings };
    }

    if (existing.ticket_id && existing.matched_rule_id) {
      const rule = (await trx('rmm_alert_rules')
        .where({ tenant: event.tenantId, rule_id: existing.matched_rule_id })
        .first()) as RmmAlertRuleRow | undefined;
      const actions = parseActions(rule ?? null, warnings);
      if (actions?.autoResolveTicket) {
        await addAlertInternalNote(
          trx,
          event.tenantId,
          existing.ticket_id,
          `Alert resolved in ${providerLabel(event.provider)}.\nExternal alert ID: ${event.externalAlertId}`
        );
        if (await isTicketUntouched(trx, event.tenantId, existing.ticket_id)) {
          const statusId = await resolveCloseStatusId(trx, event.tenantId, actions, existing.ticket_id);
          if (statusId) {
            await trx('tickets')
              .where({ tenant: event.tenantId, ticket_id: existing.ticket_id })
              .update({ status_id: statusId, updated_at: new Date().toISOString() });
            await trx('rmm_alerts')
              .where({ tenant: event.tenantId, alert_id: existing.alert_id })
              .update({ status: 'auto_resolved' });
            await addAlertInternalNote(
              trx,
              event.tenantId,
              existing.ticket_id,
              'Ticket closed automatically: the alert resolved and the ticket had no human activity.'
            );
          } else {
            warnings.push('No closed status available for auto-resolution; ticket left open');
          }
        }
      }
    }

    return { outcome: 'resolved', alertId: existing.alert_id, ticketId: existing.ticket_id ?? null, warnings };
  });

  if (result.outcome === 'resolved' && !resolvedQuietly) {
    await publishSafely(ctx, 'RMM_ALERT_RESOLVED', event, result, resolvedAssetId);
  }

  return result;
}

async function processAcknowledged(
  ctx: RmmAlertProcessingContext,
  event: NormalizedRmmAlertEvent
): Promise<RmmAlertProcessingResult> {
  const { knex } = ctx;
  const updated = await knex('rmm_alerts')
    .where({
      tenant: event.tenantId,
      integration_id: event.integrationId,
      external_alert_id: event.externalAlertId,
      status: 'active',
    })
    .update({
      status: 'acknowledged',
      acknowledged_at: event.occurredAt,
      updated_at: new Date().toISOString(),
    });
  return { outcome: updated > 0 ? 'acknowledged' : 'skipped', warnings: [] };
}

function parseActions(rule: RmmAlertRuleRow | null, warnings: string[]): RmmAlertRuleActions | null {
  if (!rule) return null;
  const raw = typeof rule.actions === 'string' ? safeJsonParse(rule.actions) : rule.actions;
  const parsed = rmmAlertRuleActionsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    warnings.push(`Rule ${rule.rule_id} has invalid actions; treated as record-only`);
    return null;
  }
  return parsed.data;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function resolveCloseStatusId(
  trx: Knex.Transaction,
  tenantId: string,
  actions: RmmAlertRuleActions,
  ticketId: string
): Promise<string | null> {
  if (actions.autoResolveStatusId) return actions.autoResolveStatusId;
  // Statuses are board-scoped (statuses.status_type/board_id); prefer the
  // ticket's own board, falling back to any closed ticket status.
  const ticket = await trx('tickets')
    .where({ tenant: tenantId, ticket_id: ticketId })
    .first('board_id');
  const closedOnBoard = ticket?.board_id
    ? await trx('statuses')
        .where({ tenant: tenantId, status_type: 'ticket', is_closed: true, board_id: ticket.board_id })
        .orderBy('order_number', 'asc')
        .first('status_id')
    : null;
  if (closedOnBoard?.status_id) return closedOnBoard.status_id;
  const closed = await trx('statuses')
    .where({ tenant: tenantId, status_type: 'ticket', is_closed: true })
    .orderBy('order_number', 'asc')
    .first('status_id');
  return closed?.status_id ?? null;
}

async function publishSafely(
  ctx: RmmAlertProcessingContext,
  eventType: 'RMM_ALERT_TRIGGERED' | 'RMM_ALERT_RESOLVED',
  event: NormalizedRmmAlertEvent,
  result: RmmAlertProcessingResult,
  assetId?: string | null
): Promise<void> {
  if (!ctx.deps?.publishWorkflowEvent) return;
  try {
    // Shape matches RmmAlertEventPayloadSchema: optional fields are omitted,
    // never null.
    const payload: Record<string, unknown> = {
      tenantId: event.tenantId,
      integrationId: event.integrationId,
      provider: event.provider,
      alertId: result.alertId,
      externalAlertId: event.externalAlertId,
      severity: event.severity,
    };
    if (event.externalDeviceId) payload.externalDeviceId = event.externalDeviceId;
    if (assetId) payload.assetId = assetId;
    if (result.ticketId) payload.ticketId = result.ticketId;
    if (event.message) payload.message = event.message;
    if (event.sourceType) payload.sourceType = event.sourceType;
    if (event.alertClass) payload.alertClass = event.alertClass;
    if (eventType === 'RMM_ALERT_TRIGGERED') payload.triggeredAt = event.occurredAt;
    if (eventType === 'RMM_ALERT_RESOLVED') payload.resolvedAt = event.occurredAt;

    await ctx.deps.publishWorkflowEvent({ eventType, tenantId: event.tenantId, payload });
  } catch (error) {
    ctx.deps?.logger?.warn?.(`[rmm-alerts] Failed to publish ${eventType}: ${String(error)}`);
  }
}

async function notifySafely(
  ctx: RmmAlertProcessingContext,
  event: NormalizedRmmAlertEvent,
  result: RmmAlertProcessingResult,
  assetId: string | null
): Promise<void> {
  if (!ctx.deps?.notifyUsers || !result.matchedRuleId) return;
  try {
    const rule = (await ctx.knex('rmm_alert_rules')
      .where({ tenant: event.tenantId, rule_id: result.matchedRuleId })
      .first()) as RmmAlertRuleRow | undefined;
    const actions = rule ? parseActions(rule, []) : null;
    if (!actions?.notifyUserIds?.length) return;
    await ctx.deps.notifyUsers({
      tenantId: event.tenantId,
      userIds: actions.notifyUserIds,
      alert: {
        alertId: result.alertId!,
        message: event.message,
        severity: event.severity,
        assetId,
        ticketId: result.ticketId ?? null,
      },
    });
  } catch (error) {
    ctx.deps?.logger?.warn?.(`[rmm-alerts] Failed to send alert notifications: ${String(error)}`);
  }
}
