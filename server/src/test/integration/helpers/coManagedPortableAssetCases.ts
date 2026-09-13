import { randomUUID, createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import type { Knex } from 'knex';

/** Registered by the disposable schema-clone suite to reuse its real tracked
 * customer/MSP relationship fixture without starting a second database. */
export function registerCoManagedPortableAssetTests(getDb: () => Knex, fixture: () => Promise<any>) {
  async function inventory() {
    const db = getDb(), f = await fixture();
    const assetId = randomUUID(), secondId = randomUUID(), softwareId = randomUUID(), scheduleId = randomUUID();
    const clientId = (await f.customer.table('tickets').where('ticket_id', f.resource.id).first()).client_id;
    await f.customer.table('assets').insert([{ tenant: f.actor.tenant, asset_id: assetId, asset_tag: 'PORTABLE-PC',
      name: 'Customer workstation', status: 'active', client_id: clientId, asset_type: 'workstation',
      rmm_provider: 'ninjaone', rmm_device_id: 'private-provider-device', rmm_organization_id: 'private-provider-org' },
    { tenant: f.actor.tenant, asset_id: secondId, asset_tag: 'PORTABLE-SERVER', name: 'Customer server', status: 'active', client_id: clientId, asset_type: 'server' }]);
    await f.customer.table('workstation_assets').insert({ tenant: f.actor.tenant, asset_id: assetId, os_type: 'Windows', ram_gb: 32 });
    await f.customer.table('software_catalog').insert({ tenant: f.actor.tenant, software_id: softwareId, name: 'Customer tool', normalized_name: 'customer tool' });
    await f.customer.table('asset_software').insert({ tenant: f.actor.tenant, asset_id: assetId, software_id: softwareId, version: '1.2' });
    await f.customer.table('asset_relationships').insert({ tenant: f.actor.tenant, parent_asset_id: secondId, child_asset_id: assetId, relationship_type: 'managed_by' });
    await f.customer.table('asset_associations').insert({ tenant: f.actor.tenant, asset_id: assetId, entity_id: f.resource.id, entity_type: 'ticket', created_by: f.actor.userId });
    await f.customer.table('asset_history').insert({ tenant: f.actor.tenant, asset_id: assetId, changed_by: f.actor.userId, change_type: 'update',
      changes: { name: 'Customer workstation', rmm_device_id: 'historic-provider-device', service_id: randomUUID(), workstation: { ram_gb: 32, integration_id: 'historic-provider-integration' } } });
    await f.customer.table('asset_maintenance_schedules').insert({ tenant: f.actor.tenant, schedule_id: scheduleId, asset_id: assetId,
      schedule_name: 'Customer inspection', maintenance_type: 'inspection', frequency: 'monthly', frequency_interval: 1,
      schedule_config: {}, next_maintenance: new Date(), created_by: f.actor.userId });
    await f.sponsor.table('assets').insert({ tenant: f.principal.tenant, asset_tag: 'PRIVATE-MSP', name: 'MSP private asset', status: 'active', client_id: f.operation.request.clientId });
    const module = await import('../../../../../packages/co-managed/src/portableAssetExport');
    return { ...f, ...module, db, clientId, assetId, secondId, softwareId, scheduleId,
      exportAssets: () => module.exportCoManagedPortableAssets(db, f.customerPrincipal, randomUUID()) };
  }

  it('portable asset export preserves actual inventory relationships after departure without provider or commercial bindings', async () => {
    const f = await inventory();
    await f.customer.table('co_management_relationships').update({ state: 'terminated', ended_at: new Date() });
    const result = await f.exportAssets();
    expect(result.records.assets).toHaveLength(2);
    expect(result.records.workstation_assets[0]).toMatchObject({ asset_id: f.assetId, os_type: 'Windows', ram_gb: 32 });
    expect(result.records.asset_software[0]).toMatchObject({ asset_id: f.assetId, software_id: f.softwareId, version: '1.2' });
    expect(result.records.asset_relationships[0]).toMatchObject({ parent_asset_id: f.secondId, child_asset_id: f.assetId });
    expect(result.records.asset_associations[0]).toMatchObject({ asset_id: f.assetId, entity_id: f.resource.id, entity_type: 'ticket' });
    expect(result.records.asset_history[0].changes).toEqual({ name: 'Customer workstation', workstation: { ram_gb: 32 } });
    expect(result.records.asset_maintenance_schedules[0]).toMatchObject({ schedule_id: f.scheduleId, asset_id: f.assetId });
    expect(result.restorePolicy).toMatchObject({ maintenanceSchedules: 'paused', integrations: 'reauthorize', procurement: 'excluded' });
    const { sha256, ...payload } = result;
    expect(sha256).toBe(createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
    for (const excluded of ['MSP private asset', 'rmm_device_id', 'rmm_organization_id', 'service_id', 'stock_unit_id', 'integration_id', 'historic-provider', 'private-provider']) expect(JSON.stringify(result)).not.toContain(excluded);
    const invalid = structuredClone(result.records); invalid.asset_software[0].software_id = randomUUID();
    expect(() => f.validateCoManagedPortableAssetRecords(invalid)).toThrow('reference is missing');
    const duplicate = structuredClone(result.records); duplicate.asset_associations.push(duplicate.asset_associations[0]);
    expect(() => f.validateCoManagedPortableAssetRecords(duplicate)).toThrow('Duplicate');
  });

  it('portable asset export rejects actual MSP and revoked sessions, native record redactions and missing asset read permission', async () => {
    const f = await inventory();
    await expect(f.exportCoManagedPortableAssets(f.db, f.principal, randomUUID())).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    await f.customer.table('sessions').where('session_id', f.customerPrincipal.sessionId).update({ revoked_at: f.db.fn.now() });
    await expect(f.exportAssets()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    await f.customer.table('sessions').where('session_id', f.customerPrincipal.sessionId).update({ revoked_at: null });
    const bundles = await import('@alga-psa/authorization');
    const { bundleId, revisionId } = await bundles.createAuthorizationBundle(f.db, { tenant: f.actor.tenant, name: 'Asset export scope', actorUserId: f.actor.userId });
    await bundles.upsertBundleRule(f.db, { tenant: f.actor.tenant, bundleId, revisionId, resourceType: 'asset', action: 'read',
      templateKey: 'selected_clients', config: { selectedClientIds: [f.clientId], redactedFields: ['serial_number'] } });
    await bundles.publishBundleRevision(f.db, { tenant: f.actor.tenant, bundleId, revisionId, actorUserId: f.actor.userId });
    await bundles.createBundleAssignment(f.db, { tenant: f.actor.tenant, bundleId, targetType: 'user', targetId: f.actor.userId });
    await expect(f.exportAssets()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    await f.customer.table('authorization_bundle_rules').where('revision_id', revisionId).update({ config: { selectedClientIds: [f.clientId] } });
    expect((await f.exportAssets()).records.assets).toHaveLength(2);
    const permission = await f.customer.table('permissions').where({ resource: 'asset', action: 'read', msp: true }).first();
    await f.customer.table('role_permissions').where('permission_id', permission.permission_id).delete();
    await expect(f.exportAssets()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
  });
}
