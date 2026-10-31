// Shared fixtures: the real L7b1 contributor registry, collect and manifest pipeline with fixture rows in place of database reads.
import { createCorePortableRegistry, CORE_PORTABLE_CONTRIBUTORS } from '../../../../../packages/co-managed/src/portableCoreRegistry';
import { createPortableContributorRegistry } from '../../../../../packages/co-managed/src/portableContributorRegistry';
import { collectPortableWorkspace } from '../../../../../packages/co-managed/src/portableWorkspaceGraph';
import { buildCoManagedPortableWorkspaceManifest, validateCoManagedPortableWorkspaceManifest } from '../../../../../packages/co-managed/src/portableWorkspaceManifest';
import { prepareCoManagedPortableWorkspaceRecords }
  from '../../../../../packages/co-managed/src/portableWorkspaceRestoreRecords';

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const SOURCE = id(1), TARGET = id(2), PACKAGE = id(3), FOREIGN = id(4);
export const ADMIN = id(10);

/** Rows for every table of every real L7b1 contributor, with the columns the contributor declares. */
export function fixtureRecords() {
  const registry = createCorePortableRegistry();
  const records: Record<string, Record<string, Record<string, unknown>[]>> = {};
  for (const contributor of registry.list()) records[contributor.id] = Object.fromEntries(Object.keys(contributor.columns).map(table => [table, []]));
  const add = (table: string, values: Record<string, unknown>) => {
    const contributor = registry.list().find(c => Object.hasOwn(c.columns, table))!;
    const row = Object.assign(Object.fromEntries(contributor.columns[table].map(column => [column, null])), values);
    records[contributor.id][table].push(row); return row;
  };
  add('tenants', { client_name: 'Customer' });
  add('users', { user_id: ADMIN, username: 'admin', user_type: 'internal', is_inactive: false, email: 'a@example.test', first_name: 'A', last_name: 'B', needs_contact_association: false });
  add('permissions', { permission_id: id(11), resource: 'co_management', action: 'manage' });
  add('roles', { role_id: id(12), role_name: 'Admin', msp: true, client: false });
  add('user_roles', { user_id: ADMIN, role_id: id(12) });
  add('role_permissions', { role_id: id(12), permission_id: id(11) });
  add('clients', { client_id: id(20), client_name: 'Own customer' });
  add('boards', { board_id: id(30), board_name: 'Support' });
  add('statuses', { status_id: id(31), name: 'Open', board_id: id(30) });
  add('standard_statuses', { standard_status_id: id(40), name: 'Open', item_type: 'ticket', display_order: 1, is_closed: false, is_default: true });
  add('tickets', { ticket_id: id(32), ticket_number: 'T-1', title: 'Printer', board_id: id(30), status_id: id(31), client_id: id(20), entered_by: ADMIN });
  add('comment_threads', { thread_id: id(33), ticket_id: id(32), root_comment_id: id(34), created_by: ADMIN });
  add('comments', { comment_id: id(34), ticket_id: id(32), thread_id: id(33), user_id: ADMIN });
  return { registry, records, add };
}

/** The real engine (collect + manifest build + validation) with fixture rows in place of database reads. */
export async function fixtureManifest(extra: (add: ReturnType<typeof fixtureRecords>['add']) => void = () => {}, blobs: { id: string; size: number; sha256: string; path: string }[] = [], credentialVault: Record<string, unknown> | null = null) {
  const { registry, records, add } = fixtureRecords();
  extra(add);
  const stubbed = createPortableContributorRegistry(CORE_PORTABLE_CONTRIBUTORS.map(c => ({ ...c, export: async () => ({ records: records[c.id], ...(c.id === 'work' && blobs.length ? { files: { files: blobs, dispose: async () => {} } } : {}) }) })));
  const context = { packageId: PACKAGE, sourceTenant: SOURCE, capturedAt: '2026-01-01T00:00:00.000Z' };
  const collected = await collectPortableWorkspace(stubbed, { db: {} as never, actor: {} as never, packageId: PACKAGE, snapshot: { capturedAt: context.capturedAt } } as never);
  const manifest = buildCoManagedPortableWorkspaceManifest({ context, collected: { sections: collected.sections, edges: collected.edges, files: collected.files }, registry, credentialVault: credentialVault as never });
  return { manifest: validateCoManagedPortableWorkspaceManifest(JSON.parse(JSON.stringify(manifest)), context, collected.files, registry), registry, context, files: collected.files };
}
export const prepare = (manifest: Awaited<ReturnType<typeof fixtureManifest>>['manifest'], mappings: Record<string, Record<string, string>> = { standard_statuses: { [id(40)]: id(900) } }) => {
  let n = 1000;
  return prepareCoManagedPortableWorkspaceRecords({ manifest, destinationTenant: TARGET, destinationCatalogMappings: mappings }, { allocateUuid: () => id(n++) });
};

