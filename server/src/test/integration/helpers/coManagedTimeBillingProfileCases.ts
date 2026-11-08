import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { expect, it } from 'vitest';

type Fixture = (work: (fixture: any) => Promise<void>) => Promise<void>;

/**
 * The shared-work time billing profile is a soft default stored on the MSP-local routing row
 * (`co_managed_ticket_references` / `co_managed_project_task_references`.`billing_profile_id`).
 * `withTime` / `withTask` supply a participating MSP workspace with a shared ticket / project task.
 * NOT RUNNABLE without the disposable Postgres fixture (no database was reachable when authored).
 */
export function registerCoManagedTimeBillingProfileTests(getDb: () => Knex, withTime: Fixture, withTask: Fixture) {
  async function profiles(f: any) {
    const domain = await import('../../../../../packages/co-managed/src/timeBillingProfile');
    const read = () => domain.getCoManagedTimeBillingProfile(getDb(), f.principal, f.resource);
    const change = (profileId: string | null, expectedProfileId: string | null = null) =>
      domain.setCoManagedTimeBillingProfile(getDb(), f.principal, f.resource, { profileId, expectedProfileId });
    const initial = await read(), extra = randomUUID();
    await f.sponsor.table('client_billing_profiles').insert({ tenant: f.principal.tenant, billing_profile_id: extra,
      client_id: initial.clientId, name: 'MSP project services', is_default: false, is_active: true, is_system_managed_default: false });
    return { ...domain, read, change, initial, extra };
  }

  it('selects only the current MSP client\'s profiles and preserves null/default and retry semantics', async () => withTime(async f => {
    const p = await profiles(f);
    expect(p.initial.profileId).toBeNull();
    expect((await p.read()).profiles).toHaveLength(2);
    expect(await p.change(p.extra)).toEqual({ profileId: p.extra });
    expect(await p.change(p.extra)).toEqual({ profileId: p.extra });
    await expect(p.change(p.initial.profiles[0].billing_profile_id)).rejects.toMatchObject({ code: 'TIME_BILLING_PROFILE_CHANGED' });
    await expect(p.change(randomUUID(), p.extra)).rejects.toMatchObject({ code: 'INVALID_TIME_BILLING_PROFILE' });
    const otherClient = randomUUID(), otherProfile = randomUUID();
    await f.sponsor.table('clients').insert({ tenant: f.principal.tenant, client_id: otherClient, client_name: 'Unrelated MSP client' });
    await f.sponsor.table('client_billing_profiles').insert({ tenant: f.principal.tenant, billing_profile_id: otherProfile,
      client_id: otherClient, name: 'Private other client', is_default: true, is_active: true, is_system_managed_default: false });
    await expect(p.change(otherProfile, p.extra)).rejects.toMatchObject({ code: 'INVALID_TIME_BILLING_PROFILE' });
    expect((await p.read()).profiles.map((row: any) => row.billing_profile_id)).not.toContain(otherProfile);
    expect(await p.change(null, p.extra)).toEqual({ profileId: null });
  }));

  it('a profile change never rewrites approved or invoiced entries, and the profile drives contract-line selection for new MSP billable entries', async () => withTime(async f => {
    const p = await profiles(f);
    await p.change(p.extra);
    const entry = await f.save();
    await f.sponsor.table('time_entries').where('entry_id', entry.entry_id).update({ approval_status: 'APPROVED', invoiced: true });
    const retained = await f.sponsor.table('time_entries').where('entry_id', entry.entry_id).first();
    await p.change(null, p.extra);
    expect(await f.sponsor.table('time_entries').where('entry_id', entry.entry_id).first()).toEqual(retained);
    await expect(f.save({ entry_id: entry.entry_id, end_time: '2026-08-08T10:30:00Z' })).rejects.toThrow();
  }));

  it('rejects local customer callers and callers without current staff authority; the stored profile is untouched', async () => withTime(async f => {
    const p = await profiles(f);
    await expect(p.setCoManagedTimeBillingProfile(getDb(), f.customerPrincipal, f.resource, { profileId: p.extra, expectedProfileId: null }))
      .rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    await f.sponsor.table('co_management_staff_assignments').del();
    await expect(p.read()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    expect(await f.sponsor.table('co_managed_ticket_references').first('billing_profile_id')).toEqual({ billing_profile_id: null });
  }));

  it('serializes competing defaults: exactly one concurrent change wins', async () => withTime(async f => {
    const p = await profiles(f), first = p.initial.profiles[0].billing_profile_id;
    const attempts = await Promise.allSettled([p.change(first), p.change(p.extra)]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'TIME_BILLING_PROFILE_CHANGED' } });
  }));

  it('supports project tasks without modifying customer billing', async () => withTask(async f => {
    const original = await f.customer.table('project_tasks').where('task_id', f.resource.id).first();
    const p = await profiles(f);
    await p.change(p.extra);
    expect(await f.sponsor.table('co_managed_project_task_references').first()).toMatchObject({ billing_profile_id: p.extra });
    expect(await f.customer.table('project_tasks').where('task_id', f.resource.id).first()).toEqual(original);
  }));
}
