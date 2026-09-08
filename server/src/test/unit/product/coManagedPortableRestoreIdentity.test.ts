import { expect, it } from 'vitest';
import { remapCoManagedPortableIdentity, type PortableRestoreIdentitySchema } from '../../../../../packages/co-managed/src/portableRestoreIdentity';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sourceTenant = id(1), destinationTenant = id(2), foreignTenant = id(3);
function fixture() {
  const records = {
    users: [{ user_id: id(10), reports_to: null, name: 'Customer technician', note: { nested_user_id: id(10) } }],
    teams: [{ team_id: id(10), manager_id: id(10) }], // IDs can coincide across independent domains.
    team_members: [{ team_id: id(10), user_id: id(10) }],
    assets: [{ asset_id: id(12), name: 'Workstation' }],
    workstation_assets: [{ asset_id: id(12), os_type: 'Linux' }],
    standard_statuses: [{ standard_status_id: id(13), name: 'Open' }],
    project_status_mappings: [{ project_status_mapping_id: id(14), standard_status_id: id(13) }],
    workflow_form_definitions: [{ form_id: 'form-customer-intake', name: 'Intake' }],
    workflow_form_schemas: [{ schema_id: 'schema-intake-v1', form_id: 'form-customer-intake', definition: { defaultUser: id(10) } }],
    user_work_schedules: [{ user_id: id(10), day_of_week: 1 }],
    collaboration_actor_references: [
      { actor_reference_id: id(15), actor_tenant: sourceTenant, actor_user_id: id(10), display_name: 'Current local technician' },
      { actor_reference_id: id(16), actor_tenant: foreignTenant, actor_user_id: id(10), display_name: 'Foreign technician with same UUID' },
      { actor_reference_id: id(17), actor_tenant: sourceTenant, actor_user_id: id(99), display_name: 'Deleted local technician' },
    ],
  };
  const schema: PortableRestoreIdentitySchema = {
    columns: Object.fromEntries(Object.entries(records).map(([table, rows]) => [table, Object.keys(rows[0])])),
    identities: { team_members: ['team_id', 'user_id'], user_work_schedules: ['user_id', 'day_of_week'] },
    valueTypes: { workflow_form_definitions: { form_id: 'text' }, workflow_form_schemas: { schema_id: 'text', form_id: 'text' }, user_work_schedules: { day_of_week: 'integer' } },
    references: [ ['users', 'reports_to', 'users', 'user_id'], ['teams', 'manager_id', 'users', 'user_id'],
      ['team_members', 'team_id', 'teams', 'team_id'], ['team_members', 'user_id', 'users', 'user_id'],
      ['workstation_assets', 'asset_id', 'assets', 'asset_id'], ['project_status_mappings', 'standard_status_id', 'standard_statuses', 'standard_status_id'],
      ['workflow_form_schemas', 'form_id', 'workflow_form_definitions', 'form_id'], ['user_work_schedules', 'user_id', 'users', 'user_id'] ],
    identityDomains: [
      ...[['users', 'user_id'], ['teams', 'team_id'], ['assets', 'asset_id'], ['project_status_mappings', 'project_status_mapping_id'],
        ['collaboration_actor_references', 'actor_reference_id']].map(([table, column]) => ({ table, column, strategy: 'allocate' as const })),
      { table: 'standard_statuses', column: 'standard_status_id', strategy: 'provided', destinationBySource: { [id(13)]: id(500) } },
      { table: 'workflow_form_definitions', column: 'form_id', strategy: 'preserve' },
      { table: 'workflow_form_schemas', column: 'schema_id', strategy: 'provided', destinationBySource: { 'schema-intake-v1': 'restored-schema-v1' } },
      { table: 'user_work_schedules', column: 'day_of_week', strategy: 'preserve' },
    ],
    qualifiedActors: [{ table: 'collaboration_actor_references', tenantColumn: 'actor_tenant', userColumn: 'actor_user_id', localUsers: ['users', 'user_id'] }],
  };
  return { records, schema };
}
function restore(f = fixture(), allocateUuid?: () => string) {
  let next = 1000;
  return remapCoManagedPortableIdentity(f.records, f.schema, { sourceTenant, destinationTenant, allocateUuid: allocateUuid ?? (() => id(next++)) });
}
it('rewrites local domains, composite keys, extension aliases, destination globals and explicit text keys', () => {
  const { records, domains } = restore();
  expect(records.users[0].user_id).not.toBe(records.teams[0].team_id);
  expect(records.team_members[0]).toEqual({ team_id: records.teams[0].team_id, user_id: records.users[0].user_id });
  expect(records.workstation_assets[0].asset_id).toBe(records.assets[0].asset_id);
  expect(records.standard_statuses[0].standard_status_id).toBe(id(500));
  expect(records.project_status_mappings[0].standard_status_id).toBe(id(500));
  expect(records.workflow_form_schemas[0]).toMatchObject({ schema_id: 'restored-schema-v1', form_id: 'form-customer-intake' });
  expect(records.user_work_schedules[0]).toEqual({ user_id: records.users[0].user_id, day_of_week: 1 });
  expect(domains.find(row => row.table === 'users')?.mappings).toEqual([{ source: id(10), destination: records.users[0].user_id }]);
});
it('remaps a live local actor and preserves whole foreign or deleted-local historical pairs without adding logins', () => {
  const { records } = restore();
  expect(records.users).toHaveLength(1);
  expect(records.collaboration_actor_references[0]).toMatchObject({ actor_tenant: destinationTenant, actor_user_id: records.users[0].user_id, display_name: 'Current local technician' });
  expect(records.collaboration_actor_references[1]).toMatchObject({ actor_tenant: foreignTenant, actor_user_id: id(10) });
  expect(records.collaboration_actor_references[2]).toMatchObject({ actor_tenant: sourceTenant, actor_user_id: id(99) });
});
it('never guesses ID domains inside authored JSON and leaves input records and metadata untouched', () => {
  const f = fixture(), before = structuredClone(f);
  const result = restore(f);
  expect(f).toEqual(before);
  expect(result.records.users[0].note).toEqual({ nested_user_id: id(10) });
  expect(result.records.workflow_form_schemas[0].definition).toEqual({ defaultUser: id(10) });
  expect(JSON.stringify(result)).not.toContain('sessions');
});
it('rejects malformed, reused and source/destination namespace-colliding allocated UUIDs', () => {
  for (const value of ['invalid', sourceTenant, destinationTenant, id(10), id(500), id(99), foreignTenant, id(1000)]) {
    expect(() => restore(fixture(), () => value)).toThrow();
  }
  expect(() => remapCoManagedPortableIdentity(fixture().records, fixture().schema, { sourceTenant, destinationTenant: sourceTenant })).toThrow('isolated');
});
it('requires complete one-to-one destination global mappings and rejects extra normalized source keys', () => {
  const f = fixture();
  const domain = f.schema.identityDomains.find(row => row.table === 'standard_statuses')!;
  domain.destinationBySource = {}; expect(() => restore(f)).toThrow('incomplete');
  domain.destinationBySource = { [id(13)]: destinationTenant }; expect(() => restore(f)).toThrow('tenant namespace');
  domain.destinationBySource = { [id(13)]: id(500), [id(999)]: id(501) }; expect(() => restore(f)).toThrow('Unexpected');
  f.records.standard_statuses.push({ standard_status_id: id(18), name: 'Closed' });
  domain.destinationBySource = { [id(13)]: id(500), [id(18)]: id(500) }; expect(() => restore(f)).toThrow('collide');
});
it('fails on missing or ambiguous identity metadata rather than retaining a source local key', () => {
  const f = fixture();
  f.schema.identityDomains = f.schema.identityDomains.filter(row => row.table !== 'users');
  expect(() => restore(f)).toThrow('mapping is missing');
  const g = fixture(); g.schema.identityDomains = [...g.schema.identityDomains, { table: 'workstation_assets', column: 'asset_id', strategy: 'allocate' }];
  expect(() => restore(g)).toThrow('Ambiguous');
  const h = fixture(); h.schema.references = [...h.schema.references!, ['collaboration_actor_references', 'actor_user_id', 'users', 'user_id']];
  expect(() => restore(h)).toThrow();
});
it('rejects broken scalar references and extra input columns before allocating anything', () => {
  const f = fixture(); f.records.team_members[0].user_id = id(900);
  let called = false;
  expect(() => restore(f, () => { called = true; return id(1000); })).toThrow('reference is missing'); expect(called).toBe(false);
  const g = fixture(); Object.assign(g.records.users[0], { session_token: 'never-import' });
  expect(() => restore(g)).toThrow('columns');
});
it('snapshots the transformation terms before calling an injected allocator', () => {
  const f = fixture(); let next = 1000;
  const result = restore(f, () => { f.records.users[0].name = 'Changed externally'; f.schema.references = []; return id(next++); });
  expect(result.records.users[0].name).toBe('Customer technician');
  expect(result.records.team_members[0].user_id).toBe(result.records.users[0].user_id);
});
it('supports explicit text form renaming and case-normalized UUID references without rewriting opaque text', () => {
  const f = fixture(); const upper = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  f.records.users[0].user_id = upper.toUpperCase(); f.records.teams[0].manager_id = upper;
  f.records.team_members[0].user_id = upper; f.records.user_work_schedules[0].user_id = upper;
  f.records.collaboration_actor_references[0].actor_user_id = upper;
  const form = f.schema.identityDomains.find(row => row.table === 'workflow_form_definitions')!;
  form.strategy = 'provided'; form.destinationBySource = { 'form-customer-intake': 'form-restored-intake' };
  const result = restore(f);
  expect(result.records.teams[0].manager_id).toBe(result.records.users[0].user_id);
  expect(result.records.workflow_form_schemas[0].form_id).toBe('form-restored-intake');
  expect(result.records.workflow_form_schemas[0].definition).toEqual({ defaultUser: id(10) });
});
