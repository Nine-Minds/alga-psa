import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { expect, it, vi } from 'vitest';

type Fixture = (work: (fixture: any) => Promise<void>) => Promise<void>;
export function registerCoManagedTimeBillingProfileTests(getDb: () => Knex, withTime: Fixture, withTask: Fixture) {
  async function profiles(f: any) {
    for (const [resource, action] of [['client', 'read'], ['time_entry', 'read'], ['time_entry', 'create']]) {
      let permission = await f.sponsor.table('permissions').where({ resource, action, msp: true, client: false }).first();
      if (!permission) {
        permission = await f.customer.table('permissions').where({ resource, action, msp: true, client: false }).first();
        await f.sponsor.table('permissions').insert({ ...permission, tenant: f.principal.tenant });
      }
      await f.sponsor.table('role_permissions').insert({ tenant: f.principal.tenant, role_id: f.roleId, permission_id: permission.permission_id })
        .onConflict(['tenant', 'role_id', 'permission_id']).ignore();
    }
    const domain = await import('../../../../../packages/co-managed/src/timeBillingProfile');
    const read = () => domain.getCoManagedTimeBillingProfile(getDb(), f.principal, f.resource);
    const change = (profileId: string | null, expectedProfileId: string | null = null) =>
      domain.setCoManagedTimeBillingProfile(getDb(), f.principal, f.resource, { profileId, expectedProfileId });
    const initial = await read(), extra = randomUUID();
    await f.sponsor.table('client_billing_profiles').insert({ tenant: f.principal.tenant, billing_profile_id: extra,
      client_id: initial.clientId, name: 'MSP project services', is_default: false, is_active: true, is_system_managed_default: false });
    return { ...domain, read, change, initial, extra };
  }

  it('shared time profile selects only the current MSP client and preserves null/default and retry semantics', async () => withTime(async f => {
    const p = await profiles(f);
    expect(p.initial.profileId).toBeNull();
    expect((await p.read()).profiles).toHaveLength(2);
    expect(await p.change(p.extra)).toEqual({ profileId: p.extra });
    expect(await p.change(p.extra)).toEqual({ profileId: p.extra });
    expect(await f.sponsor.table('audit_logs').where({ table_name: 'co_managed_time_work_references', record_id: f.referenceId })).toHaveLength(1);
    await expect(p.change(p.initial.profiles[0].billing_profile_id)).rejects.toMatchObject({ code: 'TIME_BILLING_PROFILE_CHANGED' });
    await expect(p.change(randomUUID(), p.extra)).rejects.toMatchObject({ code: 'INVALID_TIME_BILLING_PROFILE' });
    const otherClient = randomUUID(), otherProfile = randomUUID();
    await f.sponsor.table('clients').insert({ tenant: f.principal.tenant, client_id: otherClient, client_name: 'Unrelated MSP client' });
    await f.sponsor.table('client_billing_profiles').insert({ tenant: f.principal.tenant, billing_profile_id: otherProfile,
      client_id: otherClient, name: 'Private other client', is_default: true, is_active: true, is_system_managed_default: false });
    await expect(p.change(otherProfile, p.extra)).rejects.toMatchObject({ code: 'INVALID_TIME_BILLING_PROFILE' });
    expect((await p.read()).profiles.map((row: any) => row.billing_profile_id)).not.toContain(otherProfile);
    expect(await p.change(null, p.extra)).toEqual({ profileId: null });
    await f.sponsor.table('client_billing_profiles').where('billing_profile_id', p.extra).update({ is_active: false });
    expect((await p.read()).profiles).toHaveLength(1);
    await expect(p.change(p.extra)).rejects.toMatchObject({ code: 'INVALID_TIME_BILLING_PROFILE' });
  }));

  it('shared time profile changes preserve approved and invoiced entries while native contract selection uses the new default', async () => withTime(async f => {
    const p = await profiles(f), lineIds = [randomUUID(), randomUUID()];
    for (const [index, profileId] of [p.initial.profiles[0].billing_profile_id, p.extra].entries()) {
      const contractId = randomUUID();
      await f.sponsor.table('contracts').insert({ tenant: f.principal.tenant, contract_id: contractId, contract_name: `Profile contract ${index}`, is_active: true });
      await f.sponsor.table('contract_lines').insert({ tenant: f.principal.tenant, contract_line_id: lineIds[index], contract_id: contractId,
        contract_line_name: 'Support', contract_line_type: 'Hourly', billing_frequency: 'monthly', is_active: true, is_template: false, cadence_owner: 'client', billing_profile_id: profileId });
      await f.sponsor.table('client_contracts').insert({ tenant: f.principal.tenant, client_contract_id: randomUUID(), client_id: p.initial.clientId,
        contract_id: contractId, start_date: '2026-01-01', is_active: true });
      await f.sponsor.table('contract_line_services').insert({ tenant: f.principal.tenant, contract_line_id: lineIds[index], service_id: f.serviceId, quantity: 1 });
    }
    await p.change(p.extra);
    const entry = await f.save();
    expect(entry).toMatchObject({ contract_line_id: lineIds[1], contract_line_source: 'auto_billing_profile' });
    await f.sponsor.table('time_entries').where('entry_id', entry.entry_id).update({ approval_status: 'APPROVED', invoiced: true });
    const retained = await f.sponsor.table('time_entries').where('entry_id', entry.entry_id).first();
    await p.change(null, p.extra);
    expect(await f.sponsor.table('time_entries').where('entry_id', entry.entry_id).first()).toEqual(retained);
    await expect(f.save({ entry_id: entry.entry_id, end_time: '2026-09-08T10:30:00Z' })).rejects.toThrow();
  }));

  it('shared time profile rejects local customer callers, stale trust and private home client policy', async () => withTime(async f => {
    const p = await profiles(f);
    await expect(p.setCoManagedTimeBillingProfile(getDb(), f.customerPrincipal, f.resource, { profileId: p.extra, expectedProfileId: null }))
      .rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    const bundles = await import('@alga-psa/authorization');
    const { bundleId, revisionId } = await bundles.createAuthorizationBundle(getDb(), { tenant: f.principal.tenant, name: 'Private profile policy', actorUserId: f.principal.userId });
    await bundles.upsertBundleRule(getDb(), { tenant: f.principal.tenant, bundleId, revisionId, resourceType: 'client', action: 'read', templateKey: 'selected_clients',
      config: { selectedClientIds: [p.initial.clientId], redactedFields: ['billing_profile_id'] } });
    await bundles.publishBundleRevision(getDb(), { tenant: f.principal.tenant, bundleId, revisionId, actorUserId: f.principal.userId });
    await bundles.createBundleAssignment(getDb(), { tenant: f.principal.tenant, bundleId, targetType: 'user', targetId: f.principal.userId });
    await expect(p.read()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    await expect(p.change(p.extra)).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    await f.sponsor.table('co_management_staff_assignments').del();
    await expect(p.read()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    expect(await f.sponsor.table('co_managed_time_work_references').where('reference_id', f.referenceId).first('billing_profile_id')).toEqual({ billing_profile_id: null });
  }));

  it('shared time profile serializes competing defaults and rolls back a change if final authority expires', async () => withTime(async f => {
    const p = await profiles(f), first = p.initial.profiles[0].billing_profile_id;
    const attempts = await Promise.allSettled([p.change(first), p.change(p.extra)]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'TIME_BILLING_PROFILE_CHANGED' } });
    const before = await p.read(), next = before.profileId === first ? p.extra : first;
    const identity = await import('../../../../../packages/co-managed/src/sharedWorkIdentity'), original = identity.assertCoManagedSessionUnexpired;
    const verify = vi.spyOn(identity, 'assertCoManagedSessionUnexpired').mockImplementation(async (trx, actor) => {
      await original(trx, actor);
      const row = await trx('co_managed_time_work_references').where({ tenant: actor.tenant, reference_id: f.referenceId }).first('billing_profile_id');
      if (row?.billing_profile_id === next) throw new identity.CoManagedSharedWorkError();
    });
    try { await expect(p.change(next, before.profileId)).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' }); }
    finally { verify.mockRestore(); }
    expect((await p.read()).profileId).toBe(before.profileId);
  }));

  it('shared time profile supports canonical project tasks without modifying customer billing or native assignment', async () => withTask(async f => {
    const original = await f.customer.table('project_tasks').where('task_id', f.resource.id).first();
    const p = await profiles(f);
    expect(await f.sponsor.table('co_managed_time_work_references')).toHaveLength(0);
    await p.change(p.extra);
    expect(await f.sponsor.table('co_managed_time_work_references').first()).toMatchObject({ source_kind: 'project_task', source_id: f.resource.id,
      customer_tenant: f.resource.tenant, client_id: p.initial.clientId, billing_profile_id: p.extra });
    expect(await f.customer.table('project_tasks').where('task_id', f.resource.id).first()).toEqual(original);
    await f.customer.table('co_management_project_scopes').del();
    await expect(p.change(null, p.extra)).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
  }));
}
