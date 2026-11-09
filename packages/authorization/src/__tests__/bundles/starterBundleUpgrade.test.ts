import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Row = Record<string, any>;

const state = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, nextRevision: 2, nextRule: 3 }));

class Query {
  private readonly table: string;
  private filters: Array<Record<string, unknown>> = [];
  private ordering: { column: string; direction: 'asc' | 'desc' } | undefined;
  private aggregate: { kind: 'max' | 'count'; column: string; alias: string } | undefined;

  constructor(table: string) {
    this.table = table.split(' as ')[0];
  }

  private get rows(): Row[] {
    return state.tables[this.table] ?? (state.tables[this.table] = []);
  }

  where(arg: string | Record<string, unknown>, value?: unknown) {
    this.filters.push(typeof arg === 'string' ? { [arg.split('.').at(-1)!]: value } : arg);
    return this;
  }

  forUpdate() { return this; }
  orderBy(column: string, direction: 'asc' | 'desc' = 'asc') { this.ordering = { column: column.split('.').at(-1)!, direction }; return this; }
  max(expression: string) {
    const [, column, alias] = expression.match(/^(.+?)\s+as\s+(.+)$/i) ?? [];
    this.aggregate = { kind: 'max', column: column.split('.').at(-1)!, alias };
    return this;
  }
  count(expression: string) {
    const [, column, alias] = expression.match(/^(.+?)\s+as\s+(.+)$/i) ?? [];
    this.aggregate = { kind: 'count', column: column.split('.').at(-1)!, alias };
    return this;
  }

  private filteredRows() {
    let rows = this.rows.filter(row => this.filters.every(filter =>
      Object.entries(filter).every(([key, value]) => row[key.split('.').at(-1)!] === value)));
    if (this.ordering) {
      const { column, direction } = this.ordering;
      rows = rows.sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (direction === 'asc' ? 1 : -1));
    }
    return rows;
  }

  first<T = Row>(...columns: string[]): Promise<T | undefined> {
    const rows = this.filteredRows();
    if (this.aggregate) {
      const { kind, column, alias } = this.aggregate;
      const values = rows.map(row => Number(row[column])).filter(Number.isFinite);
      return Promise.resolve({ [alias]: kind === 'count' ? rows.length : (values.length ? Math.max(...values) : null) } as T);
    }
    return Promise.resolve(project(rows[0], columns) as T | undefined);
  }

  select<T = Row[]>(...columns: string[]): Promise<T> {
    return Promise.resolve(this.filteredRows().map(row => project(row, columns)) as T);
  }

  insert(payload: Row | Row[]) {
    const inserted = (Array.isArray(payload) ? payload : [payload]).map(row => {
      const copy = { ...row };
      if (this.table === 'authorization_bundle_revisions' && !copy.revision_id) copy.revision_id = `revision-${state.nextRevision++}`;
      if (this.table === 'authorization_bundle_rules' && !copy.rule_id) copy.rule_id = `rule-${state.nextRule++}`;
      this.rows.push(copy);
      return copy;
    });
    return { returning: (columns: string | string[]) => Promise.resolve(inserted.map(row => project(row, Array.isArray(columns) ? columns : [columns]))) };
  }

  update(patch: Row): Promise<number> {
    const rows = this.filteredRows();
    rows.forEach(row => Object.assign(row, patch));
    return Promise.resolve(rows.length);
  }
}

function project(row: Row | undefined, columns: string[]): Row | undefined {
  if (!row) return undefined;
  if (columns.length === 0) return { ...row };
  return Object.fromEntries(columns.map(column => {
    const [source, alias] = column.split(/\s+as\s+/i);
    const key = source.split('.').at(-1)!;
    return [alias ?? key, row[key]];
  }));
}

const db = Object.assign((table: string) => new Query(table), {
  transaction: async (callback: (trx: any) => Promise<unknown>) => callback(db),
  fn: { now: () => '2026-11-02T00:00:00.000Z' },
});

const require = createRequire(import.meta.url);
const migration = require(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../server/migrations/20261102120000_restrict_existing_asset_operator_deletes.cjs')) as {
  up(knex: any): Promise<void>;
};

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, tenant: string) => ({ table: (name: string) => conn(name).where({ tenant }) }),
}));

import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
} from '../../kernel';
import { ensurePublishedBundleRule } from '../../bundles/service';

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const BUNDLE_ID = 'restricted-a';
const OTHER_BUNDLE_ID = 'restricted-b';
const OLD_REVISION = 'revision-1';
const OTHER_REVISION = 'revision-b1';

function seedOldBundles() {
  state.tables.tenants = [{ tenant: TENANT }, { tenant: OTHER_TENANT }];
  state.tables.authorization_bundles = [
    { tenant: TENANT, bundle_id: BUNDLE_ID, bundle_key: 'restricted-asset-operator', name: 'Restricted Asset Operator', description: 'Keep this text', is_system: true, status: 'active', published_revision_id: OLD_REVISION, updated_by: 'prior-admin' },
    { tenant: OTHER_TENANT, bundle_id: OTHER_BUNDLE_ID, bundle_key: 'restricted-asset-operator', name: 'Other tenant bundle', description: 'Other tenant config', is_system: true, status: 'active', published_revision_id: OTHER_REVISION, updated_by: 'other-admin' },
  ];
  state.tables.authorization_bundle_revisions = [
    { tenant: TENANT, bundle_id: BUNDLE_ID, revision_id: OLD_REVISION, revision_number: 1, lifecycle_state: 'published' },
    { tenant: TENANT, bundle_id: BUNDLE_ID, revision_id: 'revision-draft', revision_number: 2, lifecycle_state: 'draft' },
    { tenant: OTHER_TENANT, bundle_id: OTHER_BUNDLE_ID, revision_id: OTHER_REVISION, revision_number: 1, lifecycle_state: 'published' },
  ];
  state.tables.authorization_bundle_rules = [
    { tenant: TENANT, bundle_id: BUNDLE_ID, revision_id: OLD_REVISION, rule_id: 'read-rule', resource_type: 'asset', action: 'read', template_key: 'selected_clients', effect: 'narrow', constraint_key: null, config: { selectedClientIds: ['client-a'], preserved: { source: 'existing' } }, position: 0 },
    { tenant: TENANT, bundle_id: BUNDLE_ID, revision_id: OLD_REVISION, rule_id: 'update-rule', resource_type: 'asset', action: 'update', template_key: 'same_team', effect: 'narrow', constraint_key: null, config: { operatorSetting: 'keep' }, position: 1 },
    { tenant: TENANT, bundle_id: BUNDLE_ID, revision_id: 'revision-draft', rule_id: 'draft-unrelated', resource_type: 'ticket', action: 'read', template_key: 'all', effect: 'narrow', constraint_key: null, config: { unfinished: true }, position: 0 },
    { tenant: OTHER_TENANT, bundle_id: OTHER_BUNDLE_ID, revision_id: OTHER_REVISION, rule_id: 'other-read', resource_type: 'asset', action: 'read', template_key: 'selected_clients', effect: 'narrow', constraint_key: null, config: { selectedClientIds: ['other-client'] }, position: 0 },
    { tenant: OTHER_TENANT, bundle_id: OTHER_BUNDLE_ID, revision_id: OTHER_REVISION, rule_id: 'other-update', resource_type: 'asset', action: 'update', template_key: 'same_team', effect: 'narrow', constraint_key: null, config: {}, position: 1 },
  ];
  state.tables.authorization_bundle_assignments = [
    { tenant: TENANT, bundle_id: BUNDLE_ID, assignment_id: 'assignment-a', status: 'active', target_type: 'role', target_id: 'role-a' },
  ];
  state.nextRevision = 3;
  state.nextRule = 3;
}

function persistedRules(tenant: string, revisionId: string) {
  return state.tables.authorization_bundle_rules
    .filter(row => row.tenant === tenant && row.revision_id === revisionId)
    .sort((a, b) => a.position - b.position)
    .map(row => ({
      id: row.rule_id,
      resource: row.resource_type,
      action: row.action,
      templateKey: row.template_key,
      selectedClientIds: row.config?.selectedClientIds,
    }));
}

function actionAllowed(revisionId: string, action: 'read' | 'update' | 'delete', asset: { asset_id: string; client_id: string; teamIds?: string[] }, subjectTeamIds: string[]) {
  const kernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async input => persistedRules(input.subject.tenant, revisionId),
    }),
    rbacEvaluator: async () => true,
  });
  return kernel.authorizeResource({
    subject: { tenant: TENANT, userId: 'operator', userType: 'internal', roleIds: [], teamIds: subjectTeamIds, managedUserIds: [], clientId: null, portfolioClientIds: [] },
    resource: { type: 'asset', action, id: asset.asset_id },
    record: { id: asset.asset_id, clientId: asset.client_id, teamIds: asset.teamIds ?? [], ownerUserId: null, assignedUserIds: [] },
    requestCache: new RequestLocalAuthorizationCache(),
    knex: db as any,
  }).then(decision => decision.allowed);
}

async function deleteAssetUnderBundle(revisionId: string, assetId: string, subjectTeamIds: string[]): Promise<boolean> {
  const asset = state.tables.assets.find(row => row.asset_id === assetId);
  if (!asset || !await actionAllowed(revisionId, 'delete', asset, subjectTeamIds)) return false;
  state.tables.assets = state.tables.assets.filter(row => row.asset_id !== assetId);
  return true;
}

describe('restricted asset operator starter bundle upgrade', () => {
  beforeEach(() => {
    seedOldBundles();
  });

  it('publishes same-team delete narrowing for the old bundle without changing its existing configuration', async () => {
    const asset = { asset_id: 'asset-outside-team', client_id: 'client-b', teamIds: ['team-asset'] };

    // Without an explicit delete rule, delete inherits the existing same-team update rule.
    expect(await actionAllowed(OLD_REVISION, 'read', asset, ['team-subject'])).toBe(false);
    expect(await actionAllowed(OLD_REVISION, 'update', asset, ['team-subject'])).toBe(false);
    expect(await actionAllowed(OLD_REVISION, 'delete', asset, ['team-subject'])).toBe(false);
    expect(await actionAllowed(OLD_REVISION, 'delete', asset, ['team-asset'])).toBe(true);

    await migration.up(db as any);

    const bundle = state.tables.authorization_bundles.find(row => row.tenant === TENANT && row.bundle_id === BUNDLE_ID)!;
    const newRevision = bundle.published_revision_id;
    expect(newRevision).not.toBe(OLD_REVISION);
    expect(state.tables.authorization_bundle_revisions.find(row => row.revision_id === OLD_REVISION)?.lifecycle_state).toBe('archived');
    expect(state.tables.authorization_bundle_revisions.find(row => row.revision_id === newRevision)).toMatchObject({ revision_number: 3, lifecycle_state: 'published' });
    expect(state.tables.authorization_bundle_revisions.find(row => row.revision_id === 'revision-draft')?.lifecycle_state).toBe('draft');
    expect(state.tables.authorization_bundle_rules.filter(row => row.revision_id === 'revision-draft')).toEqual([
      expect.objectContaining({ rule_id: 'draft-unrelated', config: { unfinished: true }, action: 'read' }),
    ]);

    const rules = state.tables.authorization_bundle_rules.filter(row => row.tenant === TENANT && row.revision_id === newRevision);
    expect(rules).toHaveLength(3);
    expect(rules.find(row => row.action === 'read')).toMatchObject({ config: { selectedClientIds: ['client-a'], preserved: { source: 'existing' } } });
    expect(rules.find(row => row.action === 'update')).toMatchObject({ config: { operatorSetting: 'keep' } });
    expect(rules.find(row => row.action === 'delete')).toMatchObject({ resource_type: 'asset', template_key: 'same_team', position: 2 });

    expect(await actionAllowed(newRevision, 'read', asset, ['team-subject'])).toBe(false);
    expect(await actionAllowed(newRevision, 'update', asset, ['team-subject'])).toBe(false);
    expect(await actionAllowed(newRevision, 'delete', asset, ['team-subject'])).toBe(false);
    state.tables.assets = [{ tenant: TENANT, ...asset, name: 'Original name' }];
    expect(await deleteAssetUnderBundle(newRevision, asset.asset_id, ['team-subject'])).toBe(false);
    expect(state.tables.assets).toEqual([{ tenant: TENANT, ...asset, name: 'Original name' }]);
    expect(await deleteAssetUnderBundle(newRevision, asset.asset_id, ['team-asset'])).toBe(true);
    expect(state.tables.assets).toEqual([]);

    expect(bundle).toMatchObject({ name: 'Restricted Asset Operator', description: 'Keep this text', is_system: true, status: 'active', updated_by: 'prior-admin' });
    expect(state.tables.authorization_bundle_assignments).toHaveLength(1);
    const otherTenantBundle = state.tables.authorization_bundles.find(row => row.tenant === OTHER_TENANT && row.bundle_id === OTHER_BUNDLE_ID)!;
    expect(otherTenantBundle.published_revision_id).not.toBe(OTHER_REVISION);
    expect(state.tables.authorization_bundle_rules.filter(row => row.tenant === OTHER_TENANT && row.revision_id === otherTenantBundle.published_revision_id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'delete', resource_type: 'asset', template_key: 'same_team' }),
      expect.objectContaining({ config: { selectedClientIds: ['other-client'] } }),
    ]));
    expect(state.tables.authorization_bundle_rules
      .filter(row => row.tenant === OTHER_TENANT && row.bundle_id === OTHER_BUNDLE_ID)
      .some(row => row.config?.selectedClientIds?.includes('client-a'))).toBe(false);
  });

  it('narrows deletion independently of a customized client-scoped update rule', async () => {
    const updateRule = state.tables.authorization_bundle_rules.find(row =>
      row.tenant === TENANT && row.revision_id === OLD_REVISION && row.action === 'update')!;
    updateRule.template_key = 'selected_clients';
    updateRule.config = { ...updateRule.config, selectedClientIds: ['client-a'] };
    const asset = { asset_id: 'asset-outside-team', client_id: 'client-a', teamIds: ['team-asset'] };
    state.tables.assets = [{ tenant: TENANT, ...asset, name: 'Original name' }];

    expect(await actionAllowed(OLD_REVISION, 'read', asset, ['team-subject'])).toBe(true);
    expect(await actionAllowed(OLD_REVISION, 'update', asset, ['team-subject'])).toBe(true);
    expect(await actionAllowed(OLD_REVISION, 'delete', asset, ['team-subject'])).toBe(true);

    await migration.up(db as any);

    const revision = state.tables.authorization_bundles.find(row =>
      row.tenant === TENANT && row.bundle_id === BUNDLE_ID)!.published_revision_id;
    expect(await actionAllowed(revision, 'read', asset, ['team-subject'])).toBe(true);
    expect(await actionAllowed(revision, 'update', asset, ['team-subject'])).toBe(true);
    expect(await deleteAssetUnderBundle(revision, asset.asset_id, ['team-subject'])).toBe(false);
    expect(state.tables.assets).toEqual([{ tenant: TENANT, ...asset, name: 'Original name' }]);
    expect(await deleteAssetUnderBundle(revision, asset.asset_id, ['team-asset'])).toBe(true);
    expect(state.tables.assets).toEqual([]);
  });

  it('is idempotent through the deployment migration entry point', async () => {
    await migration.up(db as any);
    const publishedRevision = state.tables.authorization_bundles[0].published_revision_id;
    const revisionCount = state.tables.authorization_bundle_revisions.length;
    const ruleCount = state.tables.authorization_bundle_rules.length;

    await migration.up(db as any);

    expect(state.tables.authorization_bundles[0].published_revision_id).toBe(publishedRevision);
    expect(state.tables.authorization_bundle_revisions).toHaveLength(revisionCount);
    expect(state.tables.authorization_bundle_rules).toHaveLength(ruleCount);
  });

  it('keeps an editor draft unpublished when the manual repair path runs', async () => {
    await ensurePublishedBundleRule(db as any, {
      tenant: TENANT,
      bundleId: BUNDLE_ID,
      resourceType: 'asset',
      action: 'delete',
      templateKey: 'same_team',
      config: {},
    });

    const bundle = state.tables.authorization_bundles.find(row => row.tenant === TENANT && row.bundle_id === BUNDLE_ID)!;
    expect(state.tables.authorization_bundle_revisions.find(row => row.revision_id === bundle.published_revision_id))
      .toMatchObject({ revision_number: 3, lifecycle_state: 'published' });
    expect(state.tables.authorization_bundle_revisions.find(row => row.revision_id === 'revision-draft')?.lifecycle_state).toBe('draft');
    expect(state.tables.authorization_bundle_rules.filter(row => row.revision_id === 'revision-draft'))
      .toEqual([expect.objectContaining({ rule_id: 'draft-unrelated', config: { unfinished: true } })]);
  });
});
