import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A2/A3 neutrality at the seam level, on the real capability evaluator.
 *
 * Kansas   = the capability's flag is off / nothing participates (no participation resolver).
 * Emerald  = flag on, but the tenant holds no entitlement (participation resolver answers "no").
 * Both must be indistinguishable: the provider is never constructed or called, no database
 * statement is issued, and `{ handled: false }` comes back. Served tenants (and FORCE on) do reach
 * the provider; FORCE_CAPABILITIES=co-managed:off wins over participation.
 */
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { registerCapabilityParticipation } from '@alga-psa/core/capability';
import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import { scheduleSeam } from '@alga-psa/scheduling/lib/sharedWorkScheduling';
import { interactionSeam } from '../../../../../packages/clients/src/lib/coManagedInteractionReader';
import { meetingDocumentsSeam } from '../../../../../packages/documents/src/lib/meetingDocumentAdmission';
import { meetingArtifactSeam } from '../../../lib/online-meetings/meetingArtifactDelivery';

const TENANT = '11111111-1111-4111-8111-111111111111';

/** A knex stand-in that records every property touched; any use is a statement. */
function recordingKnex() {
  const touched: string[] = [];
  const knex = new Proxy(function () {}, {
    get(_t, prop) { touched.push(String(prop)); return () => { throw new Error(`unexpected SQL via ${String(prop)}`); }; },
    apply() { touched.push('call'); throw new Error('unexpected SQL'); },
  });
  return { knex: knex as any, touched };
}

const seams = [
  { name: 'scheduling', seam: scheduleSeam as any, verbs: ['readSchedules', 'commandSchedule', 'readAppointmentRequests', 'approveAppointment', 'approveAppointmentWithMeeting', 'declineAppointment', 'rescheduleAppointment', 'associateAppointmentTicket', 'generateAppointmentMeeting'] },
  { name: 'interaction', seam: interactionSeam as any, verbs: ['readInteractions', 'readInteractionMeeting', 'createInteraction', 'updateInteraction', 'deleteInteraction'] },
  { name: 'meetingDocuments', seam: meetingDocumentsSeam as any, verbs: ['admitMeetingDocuments'] },
  { name: 'meetingArtifacts', seam: meetingArtifactSeam as any, verbs: ['consumeMeetingArtifact'] },
];

function spyProvider(verbs: string[]) {
  const spies: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const verb of verbs) spies[verb] = vi.fn(async () => ({ handled: true as const }));
  return spies;
}

describe.each(seams)('$name seam neutrality', ({ seam, verbs }) => {
  let spies: Record<string, ReturnType<typeof vi.fn>>;
  let factory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    delete process.env.FORCE_CAPABILITIES;
    resetCapabilityRegistry();
    seam.reset();
    spies = spyProvider(verbs);
    factory = vi.fn(() => spies);
    seam.register(factory);
  });
  afterEach(() => {
    delete process.env.FORCE_CAPABILITIES;
    seam.reset();
    resetCapabilityRegistry();
  });

  const callEveryVerb = async (db: any) => {
    const results = [];
    for (const verb of verbs) results.push(await seam.delegate(TENANT, (p: any) => p[verb](db, TENANT)));
    return results;
  };

  it('Kansas (no participation resolver) answers handled:false, builds nothing, issues no SQL', async () => {
    const { knex, touched } = recordingKnex();
    const results = await callEveryVerb(knex);
    expect(results.every(r => r.handled === false)).toBe(true);
    expect(factory).not.toHaveBeenCalled();
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
    expect(touched).toEqual([]);
  });

  it('Emerald (flag on, no entitlement) behaves identically to Kansas', async () => {
    registerCapabilityParticipation('co-managed', async () => new Set<string>());
    const { knex, touched } = recordingKnex();
    const results = await callEveryVerb(knex);
    expect(results).toEqual(verbs.map(() => ({ handled: false })));
    expect(factory).not.toHaveBeenCalled();
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
    expect(touched).toEqual([]);
  });

  it('FORCE_CAPABILITIES=co-managed:off wins even for a participating tenant', async () => {
    registerCapabilityParticipation('co-managed', async ({ tenantIds }) => new Set(tenantIds));
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    clearCapabilityCache();
    const { knex, touched } = recordingKnex();
    const results = await callEveryVerb(knex);
    expect(results.every(r => r.handled === false)).toBe(true);
    expect(factory).not.toHaveBeenCalled();
    expect(touched).toEqual([]);
  });

  it('a participating tenant reaches the provider for every verb', async () => {
    registerCapabilityParticipation('co-managed', async ({ tenantIds }) => new Set(tenantIds));
    const results = await callEveryVerb({} as any);
    expect(results.every(r => r.handled === true)).toBe(true);
    for (const spy of Object.values(spies)) expect(spy).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('FORCE_CAPABILITIES=co-managed:on reaches the provider', async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    clearCapabilityCache();
    const results = await callEveryVerb({} as any);
    expect(results.every(r => r.handled === true)).toBe(true);
  });

  it('a different tenant is not served when only one participates', async () => {
    registerCapabilityParticipation('co-managed', async ({ tenantIds }) => new Set(tenantIds.filter(id => id === TENANT)));
    const other = '22222222-2222-4222-8222-222222222222';
    expect(await seam.delegate(other, (p: any) => p[verbs[0]]({}, other))).toEqual({ handled: false });
    expect((await seam.delegate(TENANT, (p: any) => p[verbs[0]]({}, TENANT))).handled).toBe(true);
  });
});
