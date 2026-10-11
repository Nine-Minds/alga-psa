import { describe, expect, it } from 'vitest';
import { startOrganizationSlaClock as start, observeOrganizationSlaClock as observe,
  pauseOrganizationSlaClock as pause, resumeOrganizationSlaClock as resume,
  respondToOrganizationSlaClock as respond, resolveOrganizationSlaClock as resolve,
  organizationSlaDeadline } from '../../../../../packages/sla/src/services/organizationSlaClock';

const identity = { tenant: 'msp', obligationId: 'first-escalation', sourceTenant: 'customer', ticketId: 'ticket' };
const always = { timezone: 'UTC', is_24x7: true, entries: [] };
const business = { timezone: 'America/New_York', is_24x7: false,
  entries: Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, start_time: '09:00', end_time: '17:00', is_enabled: day_of_week > 0 && day_of_week < 6 })),
  holidays: [{ holiday_date: '2026-09-07', is_recurring: false }] };
const at = (seconds: number) => new Date(Date.parse('2026-09-08T12:00:00Z') + seconds * 1000).toISOString();

describe('independent organization SLA clock', () => {
  it('retains partial minutes across repeated handbacks and never restarts the obligation', () => {
    let clock = start(identity, always, { responseMinutes: 1, resolutionMinutes: 10 }, at(0));
    const original = structuredClone(clock);
    for (let i = 0; i < 10; i++) {
      clock = pause(clock, 'customer_responsible', at(i * 12 + 6));
      clock = resume(clock, 'customer_responsible', at(i * 12 + 12));
    }
    expect(clock).toMatchObject({ identity, startedAt: at(0), elapsedMilliseconds: 60000,
      response: { breached: false, dueAt: at(120) }, resolution: { dueAt: at(660) } });
    expect(observe(clock, at(121)).response.breached).toBe(true);
    expect(original).toEqual(start(identity, always, { responseMinutes: 1, resolutionMinutes: 10 }, at(0)));
  });

  it('keeps an existing breach through pause and re-escalation', () => {
    let clock = start(identity, always, { responseMinutes: 1, resolutionMinutes: 10 }, at(0));
    clock = pause(clock, 'customer_responsible', at(90));
    expect(clock.response).toMatchObject({ breached: true, dueAt: null });
    clock = resume(clock, 'customer_responsible', at(3600));
    expect(clock).toMatchObject({ elapsedMilliseconds: 90000, startedAt: at(0), response: { breached: true }, resolution: { dueAt: at(4110) } });
    expect(respond(clock, { actorTenant: 'msp', audience: 'shared_it' }, at(3600)).response)
      .toMatchObject({ breached: true, completedElapsedMilliseconds: 90000 });
  });

  it('does not resume while another independent pause reason remains', () => {
    let clock = start(identity, always, { resolutionMinutes: 10 }, at(0));
    clock = pause(clock, 'customer_responsible', at(30));
    clock = pause(clock, 'awaiting_requester', at(90));
    clock = resume(clock, 'customer_responsible', at(120));
    expect(clock).toMatchObject({ pauseReasons: ['awaiting_requester'], elapsedMilliseconds: 30000, resolution: { dueAt: null } });
    clock = resume(clock, 'awaiting_requester', at(180));
    expect(clock.resolution.dueAt).toBe(at(750));
  });

  it.each(['requester', 'shared_it'] as const)('accepts an MSP %s response and ignores customer/private messages', audience => {
    let clock = start(identity, always, { responseMinutes: 2, resolutionMinutes: 10 }, at(0));
    clock = respond(clock, { actorTenant: 'customer', audience }, at(30));
    clock = respond(clock, { actorTenant: 'msp', audience: 'organization_private' }, at(60));
    expect(clock.response.completedAt).toBeNull();
    clock = respond(clock, { actorTenant: 'msp', audience }, at(90));
    clock = respond(clock, { actorTenant: 'msp', audience }, at(180));
    expect(clock.response).toMatchObject({ completedAt: at(90), completedElapsedMilliseconds: 90000, breached: false });
    expect(clock.resolution.completedAt).toBeNull();
  });

  it('closes during handback without inventing a response or counting customer time', () => {
    let clock = start(identity, always, { responseMinutes: 2, resolutionMinutes: 10 }, at(0));
    clock = pause(clock, 'customer_responsible', at(30));
    clock = resolve(clock, at(3600));
    clock = resume(clock, 'customer_responsible', at(7200));
    expect(clock).toMatchObject({ elapsedMilliseconds: 30000, response: { completedAt: null, dueAt: null },
      resolution: { completedAt: at(3600), completedElapsedMilliseconds: 30000, breached: false } });
    expect(respond(clock, { actorTenant: 'msp', audience: 'requester' }, at(7201)).response.completedAt).toBeNull();
    const reopened = start({ ...identity, obligationId: 'reopened' }, always, { resolutionMinutes: 10 }, at(7200));
    expect(reopened.identity.obligationId).not.toBe(clock.identity.obligationId);
    expect(reopened.elapsedMilliseconds).toBe(0);
  });

  it('uses the MSP calendar across a holiday weekend and preserves a sub-minute remainder', () => {
    const clock = start(identity, business, { responseMinutes: 1 }, '2026-09-04T20:59:45.000Z');
    expect(clock.response.dueAt).toBe('2026-09-08T13:00:45.000Z');
    const stopped = pause(clock, 'customer_responsible', '2026-09-08T13:00:15.000Z');
    expect(stopped.elapsedMilliseconds).toBe(30000);
    expect(resume(stopped, 'customer_responsible', '2026-09-08T14:00:00.000Z').response.dueAt)
      .toBe('2026-09-08T14:00:30.000Z');
  });

  it('uses the changed UTC offset after a DST weekend', () => {
    const clock = start(identity, business, { resolutionMinutes: 120 }, '2026-03-06T21:00:00.000Z');
    expect(clock.resolution.dueAt).toBe('2026-03-09T14:00:00.000Z');
    expect(observe(clock, '2026-03-09T14:00:00.000Z').elapsedMilliseconds).toBe(120 * 60000);
  });

  it('snapshots the calendar and rejects impossible targets and out-of-order events', () => {
    const schedule = structuredClone(always), owner = { ...identity };
    const clock = start(owner, schedule, { responseMinutes: 1 }, at(0));
    schedule.is_24x7 = false; owner.tenant = 'different';
    expect(clock.schedule.is_24x7).toBe(true); expect(clock.identity.tenant).toBe('msp');
    expect(() => observe(clock, at(-1))).toThrow('causal order');
    expect(() => start(identity, always, { responseMinutes: -1 }, at(0))).toThrow('target');
    expect(() => organizationSlaDeadline({ ...always, is_24x7: false }, new Date(at(0)), 60000)).toThrow('cannot be scheduled');
  });
});
