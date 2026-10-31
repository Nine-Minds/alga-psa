import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The engine asks the tenant which permissions it provisions; the stubbed contributors below need no database, so every grant is provisioned.
vi.mock('../../../../../packages/co-managed/src/localPermission', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../../packages/co-managed/src/localPermission')>(), isCoManagedPermissionProvisioned: async () => true,
}));
import { createPortableContributorRegistry } from '../../../../../packages/co-managed/src/portableContributorRegistry';
import { CORE_PORTABLE_CONTRIBUTORS, createCorePortableRegistry } from '../../../../../packages/co-managed/src/portableCoreRegistry';
import { buildCoManagedPortableWorkspaceManifest as build } from '../../../../../packages/co-managed/src/portableWorkspaceManifest';
import { collectPortableWorkspace } from '../../../../../packages/co-managed/src/portableWorkspaceGraph';
import { portableOperationalContributor, createPortableOperationalContributor, validateCoManagedPortableOperationalRecords }
  from '../../../../../packages/co-managed/src/portableOperationalExport';
import { filterCommercialPortableDocuments } from '../../../../../packages/co-managed/src/portableDocumentCatalog';
import { CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS } from '../../../../../packages/co-managed/src/portableOperationalCatalog';
import { portableConversationContributor, portableConversationAudience, portableConversationVisible, validateCoManagedPortableConversationRecords }
  from '../../../../../packages/co-managed/src/portableConversationExport';
import { readPortableFileSources, CO_MANAGED_PORTABLE_FILE_CAPS } from '../../../../../packages/co-managed/src/portableDocumentExport';
import { validateCoManagedPortableEngagementRecords } from '../../../../../packages/co-managed/src/portableEngagementExport';
import { createPortableRemoteMeetingContributor, portableRemoteMeetingContributor } from '../../../../../ee/server/src/lib/co-managed/portableRemoteMeetingExport';

const ROOT = resolve(__dirname, '../../../../..');
const TENANT = '11111111-1111-4111-8111-111111111111', PACKAGE = '22222222-2222-4222-8222-222222222222';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ALL = [...CORE_PORTABLE_CONTRIBUTORS, portableRemoteMeetingContributor];
const NEW_IDS = ['operational', 'conversations', 'documents', 'artifacts', 'engagement', 'meetings'];

describe('L7b3 contributors: registry', () => {
  it('every new contributor passes the registry contract with disjoint tables', () => {
    const registry = createCorePortableRegistry([portableRemoteMeetingContributor]);
    expect(registry.list().map(c => c.id)).toEqual(['artifacts', 'assets', 'conversations', 'core', 'documents', 'engagement', 'files', 'meetings', 'operational', 'work', 'workflows']);
    for (const id of NEW_IDS) expect(registry.list().find(c => c.id === id)).toBeTruthy();
    expect(registry.owner('time_entries')?.id).toBe('operational');
    expect(registry.owner('ticket_comment_attachments')?.id).toBe('conversations');
    expect(registry.owner('documents')?.id).toBe('documents');
    expect(registry.owner('online_meeting_artifacts')?.id).toBe('artifacts');
    expect(registry.owner('online_meetings')?.id).toBe('meetings');
    expect(registry.owner('interactions')?.id).toBe('engagement');
  });
  it('the package set has ten contributors (L7b1 core/work/assets/workflows/files plus five L7b3) and the meeting contributor is only an extra', () => {
    expect(createCorePortableRegistry().list()).toHaveLength(10);
    expect(createCorePortableRegistry().owner('online_meetings')).toBeUndefined();
  });
  it('never owns MSP-private stores, billing tables or retained-command tables', () => {
    const tables = ALL.flatMap(c => Object.keys(c.columns));
    for (const table of tables) {
      expect(table).not.toMatch(/^co_management_private_/);
      expect(table).not.toMatch(/invoice|contract|billing|charge|credit/);
    }
    for (const column of CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS.time_entries) expect(column).not.toMatch(/billable|billing|service_id|contract|invoice|rate/);
  });
  it('flags the repeated wrapper and registers nothing from a PSA request path', () => {
    for (const file of ['packages/co-managed/src/portableOperationalExport.ts', 'packages/co-managed/src/portableConversationExport.ts',
      'packages/co-managed/src/portableDocumentExport.ts', 'packages/co-managed/src/portableSupplementalFileExport.ts',
      'packages/co-managed/src/portableEngagementExport.ts', 'ee/server/src/lib/co-managed/portableRemoteMeetingExport.ts']) {
      const source = readFileSync(resolve(ROOT, file), 'utf8');
      expect(source).toContain('LEVERAGE: pattern portable-contributor-boilerplate');
      expect(source).not.toMatch(/from '\.\/native|from '[./]*\/native[A-Z]/);
    }
  });
});

describe('L7b3 contributors: manifest', () => {
  const rowsFor = (c: typeof ALL[number]) => Object.fromEntries(Object.keys(c.columns).map(table => [table, []]));
  const stubbed = ALL.map(c => ({ ...c, export: async () => ({ records: rowsFor(c) as any, annotations: { exclusions: [{ class: 'deferred_domain', name: `${c.id}_empty`, reason: 'empty domain' }] } }), retain: async () => ({ records: rowsFor(c) as any }), validate: () => {} }));
  it('names every domain and carries each empty domain\'s explicit exclusion reason', async () => {
    const registry = createPortableContributorRegistry(stubbed);
    const collected = await collectPortableWorkspace(registry, { db: {} as any, actor: { kind: 'session', tenant: TENANT, userId: uuid(1), sessionId: 's' } as any, packageId: PACKAGE, snapshot: { capturedAt: '2026-01-01T00:00:00.000Z' } });
    const manifest = build({ context: { packageId: PACKAGE, sourceTenant: TENANT, capturedAt: '2026-01-01T00:00:00.000Z' }, collected: { sections: collected.sections, edges: collected.edges, files: [] }, registry });
    const ids = manifest.sections.map(s => s.id);
    for (const id of NEW_IDS) expect(ids).toContain(id);
    for (const section of manifest.sections.filter(s => NEW_IDS.includes(s.id))) {
      expect(section.annotations.exclusions).toEqual([expect.objectContaining({ name: `${section.id}_empty`, reason: 'empty domain' })]);
    }
  });
  it('every contributor source emits named exclusions', () => {
    for (const file of ['packages/co-managed/src/portableOperationalExport.ts', 'packages/co-managed/src/portableConversationExport.ts',
      'packages/co-managed/src/portableDocumentExport.ts', 'packages/co-managed/src/portableSupplementalFileExport.ts',
      'packages/co-managed/src/portableEngagementExport.ts', 'ee/server/src/lib/co-managed/portableRemoteMeetingExport.ts']) {
      expect(readFileSync(resolve(ROOT, file), 'utf8')).toMatch(/exclusions/);
    }
  });
});

describe('operational time', () => {
  it('validates an empty (native, all-commercial) tenant and rejects stray columns', () => {
    const empty = Object.fromEntries(Object.keys(CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS).map(t => [t, []]));
    expect(() => validateCoManagedPortableOperationalRecords(empty)).not.toThrow();
    expect(() => validateCoManagedPortableOperationalRecords({ ...empty, time_entries: [{ entry_id: uuid(1), billable_duration: 5 }] })).toThrow();
  });
  it('classifies through an injectable seam, never a billing_mode SQL probe', () => {
    const source = readFileSync(resolve(ROOT, 'packages/co-managed/src/portableOperationalExport.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(source).not.toMatch(/billing_mode/);
    expect(source).not.toMatch(/FOR SHARE|forShare\(\)\s*\.\s*from\('tenants'\)/);
    expect(createPortableOperationalContributor(async () => 'operational').id).toBe('operational');
    expect(portableOperationalContributor.id).toBe('operational');
  });
});

describe('conversations', () => {
  const attached = { attachment_id: uuid(1), ticket_id: uuid(2), document_id: uuid(3), created_by: uuid(4), comment_id: uuid(5), state: 'attached', created_at: 'x', expires_at: 'y' };
  const workspace = { comments: [{ comment_id: uuid(5), thread_id: uuid(6), ticket_id: uuid(2) }], comment_threads: [{ thread_id: uuid(6) }] };
  it('resolves one audience per thread and fails closed on damaged rows', () => {
    expect(portableConversationAudience({ collaboration_audience: 'requester', is_internal: false })).toBe('requester');
    expect(portableConversationAudience({ collaboration_audience: 'shared_it', is_internal: true })).toBe('shared_it');
    expect(portableConversationAudience({ collaboration_audience: 'requester', is_internal: true })).toBe('organization_private');
    expect(portableConversationAudience({ collaboration_audience: 'requester', is_internal: false, project_task_id: uuid(9) })).toBe('requester');
    expect(portableConversationAudience({ collaboration_audience: null, is_internal: false, project_task_id: uuid(9) })).toBe('organization_private');
    expect(portableConversationVisible('organization_private', TENANT)).toBe(true);
    expect(portableConversationVisible('bogus' as any, TENANT)).toBe(false);
  });
  it('keeps tombstones, rejects drafts, dangling attachments and MSP-private record sets', () => {
    const tombstone = { ...attached, attachment_id: uuid(7), comment_id: null, state: 'removed' };
    expect(() => validateCoManagedPortableConversationRecords({ ticket_comment_attachments: [attached, tombstone] }, workspace)).not.toThrow();
    expect(() => validateCoManagedPortableConversationRecords({ ticket_comment_attachments: [{ ...attached, state: 'draft' }] })).toThrow();
    expect(() => validateCoManagedPortableConversationRecords({ ticket_comment_attachments: [attached] }, { ...workspace, comments: [] })).toThrow();
    expect(() => validateCoManagedPortableConversationRecords({ ticket_comment_attachments: [] }, { ...workspace, co_management_private_comments: [] })).toThrow();
    expect(portableConversationContributor.id).toBe('conversations');
  });
});

describe('supplemental files and documents', () => {
  const fake = (rows: Record<string, unknown>[]) => ({ tenant: TENANT, table: () => ({ whereIn: () => ({ forShare: () => ({ select: async () => rows }) }) }) }) as any;
  const file = (n: number, over: Record<string, unknown> = {}) => ({ file_id: uuid(n), storage_path: `${TENANT}/f${n}`, file_size: 10, original_name: 'a', mime_type: 'text/plain', is_deleted: false, ...over });
  it('stages in-scope files and names every excluded one', async () => {
    const rows = [file(1), file(2, { file_size: CO_MANAGED_PORTABLE_FILE_CAPS.perFileBytes + 1 }), file(3, { is_deleted: true }), file(4, { file_size: null })];
    const result = await readPortableFileSources(fake(rows), [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)]);
    expect(result.blobs.map(b => b.id)).toEqual([`file:${uuid(1)}`]);
    expect(Object.fromEntries(result.excluded.map(e => [e.id, e.reason]))).toEqual({
      [uuid(2)]: 'over_file_cap', [uuid(3)]: 'missing_or_deleted', [uuid(4)]: 'unsized', [uuid(5)]: 'missing_or_deleted' });
  });
  it('enforces the package cap without truncating', async () => {
    const big = CO_MANAGED_PORTABLE_FILE_CAPS.perFileBytes;
    const rows = Array.from({ length: 12 }, (_, i) => file(i + 1, { file_size: big }));
    const result = await readPortableFileSources(fake(rows), rows.map(r => String(r.file_id)));
    expect(result.blobs.length * big).toBeLessThanOrEqual(CO_MANAGED_PORTABLE_FILE_CAPS.packageBytes);
    expect(result.excluded.every(e => e.reason === 'over_package_cap')).toBe(true);
    expect(result.blobs.length + result.excluded.length).toBe(12);
  });
  it('refuses a storage path outside the tenant scope', async () => {
    await expect(readPortableFileSources(fake([file(1, { storage_path: `${uuid(99)}/f1` })]), [uuid(1)])).rejects.toThrow();
    await expect(readPortableFileSources(fake([file(1, { storage_path: `${TENANT}/../x` })]), [uuid(1)])).rejects.toThrow();
  });
});

describe('engagement and meetings', () => {
  it('rejects availability configuration carrying unknown (provider) keys', () => {
    const empty = { interactions: [], interaction_types: [], appointment_requests: [], availability_exceptions: [], service_catalog: [], service_types: [], service_categories: [] };
    const setting = (config_json: unknown) => ({ availability_settings: [{ availability_setting_id: uuid(1), setting_type: 'x', user_id: null, service_id: null, day_of_week: null, start_time: null, end_time: null, is_available: true, buffer_before_minutes: 0, buffer_after_minutes: 0, max_appointments_per_day: null, allow_without_contract: false, advance_booking_days: 1, minimum_notice_hours: 1, config_json, created_at: 'x', updated_at: 'x' }] });
    expect(() => validateCoManagedPortableEngagementRecords({ ...empty, ...setting({ auto_approval_enabled: true }) })).not.toThrow();
    expect(() => validateCoManagedPortableEngagementRecords({ ...empty, ...setting({ oauth_token: 'secret' }) })).toThrow();
  });
  it('meeting columns carry join links but no provider identity', () => {
    const columns = portableRemoteMeetingContributor.columns.online_meetings;
    expect(columns).toContain('join_url');
    for (const hidden of ['provider_meeting_id', 'provider_event_id', 'organizer_upn', 'organizer_user_id']) expect(columns).not.toContain(hidden);
    expect(createPortableRemoteMeetingContributor({ resolveAttendance: async () => [] }).id).toBe('meetings');
  });

  it('the document commercial filter drops invoice, quote, billing-template and unclassified documents with everything attached', () => {
    const doc = (id: string, source: string | null = null) => ({ document_id: id, source_template_id: source, file_id: `f-${id}` });
    const assoc = (id: string, type: string) => ({ association_id: `a-${id}-${type}`, document_id: id, entity_type: type });
    const records = { documents: [doc('ok'), doc('inv'), doc('tpl', 'template-1'), doc('mixed'), doc('odd')],
      document_associations: [assoc('ok', 'client'), assoc('inv', 'invoice'), assoc('mixed', 'client'), assoc('mixed', 'quote'), assoc('odd', 'brand_new_type'), assoc('tpl', 'client')],
      document_versions: ['ok', 'inv', 'tpl'].map(id => ({ version_id: `v-${id}`, document_id: id })),
      document_content: [], document_block_content: [{ content_id: 'b', document_id: 'inv', version_id: 'v-inv' }],
      kb_articles: [{ article_id: 'k-inv', document_id: 'inv' }, { article_id: 'k-ok', document_id: 'ok' }],
      kb_article_relations: [{ relation_id: 'r', source_article_id: 'k-ok', target_article_id: 'k-inv' }], kb_article_reviewers: [{ reviewer_id: 'x', article_id: 'k-inv' }],
      document_folders: [{ folder_id: 'f1', parent_folder_id: null, entity_type: 'client' }, { folder_id: 'f2', parent_folder_id: null, entity_type: 'invoice' }, { folder_id: 'f3', parent_folder_id: 'f2', entity_type: 'client' }],
      document_types: [], document_default_folders: [{ default_folder_id: 'd1', entity_type: 'contract' }, { default_folder_id: 'd2', entity_type: 'ticket' }] } as any;
    const { records: kept, excludedDocuments } = filterCommercialPortableDocuments(records);
    expect(kept.documents.map((row: any) => row.document_id)).toEqual(['ok']);
    expect(excludedDocuments).toBe(4);
    expect(kept.document_associations.map((row: any) => row.document_id)).toEqual(['ok']);
    expect(kept.document_versions.map((row: any) => row.document_id)).toEqual(['ok']);
    expect(kept.document_block_content).toEqual([]);
    expect(kept.kb_articles.map((row: any) => row.article_id)).toEqual(['k-ok']);
    expect(kept.kb_article_relations).toEqual([]);
    expect(kept.kb_article_reviewers).toEqual([]);
    expect(kept.document_folders.map((row: any) => row.folder_id)).toEqual(['f1']);
    expect(kept.document_default_folders.map((row: any) => row.default_folder_id)).toEqual(['d2']);
  });
});
