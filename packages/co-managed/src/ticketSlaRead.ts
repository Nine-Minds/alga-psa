import { tenantDb } from '@alga-psa/db';
import { getCoManagedOperationalState } from '@alga-psa/licensing/lifecycle';
import { observeOrganizationSlaClock, type OrganizationSlaClock, type OrganizationSlaTargetClock } from '@alga-psa/shared/lib/sla/organizationSlaClock';
import type { CoManagedSharedWorkContext } from './sharedWork';
import { CoManagedSharedWorkError } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

export interface CoManagedSlaTargetDisplay {
  status: 'running' | 'paused' | 'breached' | 'completed' | 'not_configured' | 'not_recorded';
  dueAt: string | null;
  completedAt: string | null;
}
export interface CoManagedSlaDisplay {
  state: 'tracking' | 'not_started' | 'not_configured' | 'unavailable';
  paused?: boolean;
  response?: CoManagedSlaTargetDisplay;
  resolution?: CoManagedSlaTargetDisplay;
}
export interface CoManagedTicketSlaDisplay { customer?: CoManagedSlaDisplay; msp?: CoManagedSlaDisplay }
const iso = (value: Date | string | null | undefined) => value == null ? null : new Date(value).toISOString();

function nativeTarget(due: Date | string | null, completed: Date | string | null, met: boolean | null,
  paused: boolean, resolved: boolean, at: Date): CoManagedSlaTargetDisplay {
  const dueAt = iso(due), completedAt = iso(completed);
  const breached = met === false || (!completedAt && !paused && !resolved && dueAt !== null && Date.parse(dueAt) < at.getTime());
  return { status: breached ? 'breached' : completedAt ? 'completed' : resolved ? 'not_recorded'
    : !dueAt ? 'not_configured' : paused ? 'paused' : 'running', dueAt: paused && !completedAt ? null : dueAt, completedAt };
}
function organizationTarget(target: OrganizationSlaTargetClock, paused: boolean, resolved: boolean): CoManagedSlaTargetDisplay {
  return { status: target.breached ? 'breached' : target.completedAt ? 'completed' : target.targetMinutes === null ? 'not_configured'
    : resolved ? 'not_recorded' : paused ? 'paused' : 'running', dueAt: paused && !target.completedAt ? null : target.dueAt, completedAt: target.completedAt };
}

/** Called inside the admitted ticket reader. Return shared timing outcomes only;
 * policy IDs/names, mappings, calendars, and private pause reasons stay with their owner. */
export async function readCoManagedTicketSlaDisplay(context: CoManagedSharedWorkContext): Promise<CoManagedTicketSlaDisplay> {
  if (context.action !== 'read' || context.resource.kind !== 'ticket') throw new CoManagedSharedWorkError();
  const { trx, resource } = context, customer = tenantDb(trx, resource.tenant);
  const hidden = (names: string[]) => isCoManagedReadFieldHidden(context.redactedFields,
    ['sla', 'status', 'status_id', 'statuses', 'priority', 'priority_id', ...names].flatMap(name => [name, `tickets.${name}`]));
  const customerHidden = hidden(['sla.customer', 'customer_sla', 'sla_policy_id', 'sla_started_at', 'sla_paused_at',
    'sla_response_due_at', 'sla_response_at', 'sla_response_met', 'sla_resolution_due_at', 'sla_resolution_at', 'sla_resolution_met']);
  const mspHidden = hidden(['sla.msp', 'msp_sla', 'sla_organization_obligations', 'clock', 'work', 'co_management_ticket_work',
    'first_escalated_at', 'responsibility', 'grant_revoked_at']);
  const result: CoManagedTicketSlaDisplay = {};
  if (customerHidden && mspHidden) return result;
  const ticket = await customer.table('tickets').where('ticket_id', resource.id).first('board_id', 'sla_policy_id', 'sla_paused_at',
    'sla_response_due_at', 'sla_response_at', 'sla_response_met', 'sla_resolution_due_at', 'sla_resolution_at', 'sla_resolution_met');
  if (!ticket) throw new CoManagedSharedWorkError();
  const at = (await trx.select({ at: trx.raw('clock_timestamp()') }).first()).at as Date;
  if (!customerHidden) {
    const paused = Boolean(ticket.sla_paused_at), resolved = Boolean(ticket.sla_resolution_at);
    result.customer = !ticket.sla_policy_id ? { state: 'not_configured' } : { state: 'tracking', paused,
      response: nativeTarget(ticket.sla_response_due_at, ticket.sla_response_at, ticket.sla_response_met, paused, resolved, at),
      resolution: nativeTarget(ticket.sla_resolution_due_at, ticket.sla_resolution_at, ticket.sla_resolution_met, paused, resolved, at) };
  }
  if (!mspHidden) {
    const relationship = await customer.table('co_management_relationships').where('relationship_id', resource.relationshipId).first();
    const work = await customer.table('co_management_ticket_work').where({ relationship_id: resource.relationshipId, ticket_id: resource.id }).forShare().first();
    if (!work?.first_escalated_at) result.msp = { state: 'not_started' };
    else {
      const row = await tenantDb(trx, relationship.sponsor_tenant).table('sla_organization_obligations')
        .where({ source_tenant: resource.tenant, ticket_id: resource.id, work_id: work.work_id }).orderBy('generation', 'desc').first('clock');
      if (!row) result.msp = { state: 'unavailable' };
      else {
        const boardGrant = relationship.visibility_mode === 'board_scope' && await customer.table('co_management_board_scopes')
          .where({ relationship_id: resource.relationshipId, board_id: ticket.board_id }).forShare().first('board_id');
        const canObserve = !work.grant_revoked_at || Boolean(boardGrant);
        const lifecycle = await getCoManagedOperationalState(trx, resource.tenant);
        const saved: OrganizationSlaClock = row.clock;
        const paused = Boolean(saved.pauseReasons.length) || work.responsibility !== 'msp' || !canObserve || !lifecycle.canWrite;
        const clock = !paused && !saved.resolution.completedAt && at.getTime() >= Date.parse(saved.observedAt)
          ? observeOrganizationSlaClock(saved, at.toISOString()) : saved;
        result.msp = { state: 'tracking', paused: paused && !clock.resolution.completedAt,
          response: organizationTarget(clock.response, paused, Boolean(clock.resolution.completedAt)),
          resolution: organizationTarget(clock.resolution, paused, Boolean(clock.resolution.completedAt)) };
      }
    }
  }
  return result;
}
