import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { AmpPackageBuilder, AmpSqliteReader, validateAmpPackage } from '@alga-psa/migration-sdk';

const objects = vi.hoisted(() => new Map<string, Buffer>());
const reads = vi.hoisted(() => new Set<string>());
const transport = vi.hoisted(() => ({ failAfterWrite: false }));
vi.mock('@alga-psa/storage/StorageProviderFactory', () => ({ StorageProviderFactory: { createProvider: async () => ({
  getReadStream: async (path: string) => { reads.add(path); const bytes = objects.get(path); if (!bytes) throw new Error('unreadable'); return Readable.from([bytes]); },
  upload: async (stream: AsyncIterable<Buffer>, path: string) => { const chunks: Buffer[] = []; for await (const bytes of stream) chunks.push(bytes); objects.set(path, Buffer.concat(chunks)); if (transport.failAfterWrite) { transport.failAfterWrite = false; throw new Error('provider lost response'); } return { path }; },
  delete: async (path: string) => { objects.delete(path); },
}) } }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn(() => { throw new Error('dispatch during import'); }) }));
import { AmpExportService } from './AmpExportService';
import { AmpWorkspaceImportService } from './AmpWorkspaceImportService';

let db: Knex, directory: string, packagePath: string;
const source = randomUUID(), target = randomUUID(), other = randomUUID();
const ids = Object.fromEntries(['person', 'client', 'status', 'project', 'phase', 'task', 'period', 'sheet', 'time', 'calendar', 'interactionKind', 'interaction', 'meeting', 'file', 'document', 'article', 'workflow', 'otherClient', 'session', 'role', 'permission', 'team', 'asset', 'assetKind', 'board', 'ticket', 'ticketStatus', 'thread', 'rootComment', 'replyComment', 'scheduledComment', 'relationship', 'conversationFile', 'privateFile', 'contact', 'phone', 'extraEmail'].map(key => [key, randomUUID()]));
const bytes = Buffer.from('workspace document bytes\u0000');

beforeAll(async () => {
  const database = process.env.AMP_WORKSPACE_TEST_DATABASE;
  if (!database || !/^amp_.*_test$/.test(database)) throw new Error('Set AMP_WORKSPACE_TEST_DATABASE to an isolated amp_*_test database');
  db = knex({ client: 'pg', connection: { host: process.env.DB_HOST ?? '127.0.0.1', port: Number(process.env.DB_PORT ?? 5472), database,
    user: process.env.DB_USER_ADMIN ?? 'postgres', password: process.env.DB_PASSWORD_ADMIN ?? readFileSync('../secrets/postgres_password', 'utf8').trim() }, pool: { min: 0, max: 12 } });
  await createRequire(import.meta.url)('../../../migrations/20261106010000_amp_workspace_import.cjs').up(db);
  directory = await mkdtemp(join(tmpdir(), 'amp-roundtrip-test-')); packagePath = join(directory, 'workspace.amp');
  await db('tenants').insert([{ tenant: source, client_name: 'Source workspace', email: 'source@example.invalid', product_code: 'psa' }, { tenant: other, client_name: 'Other workspace', email: 'other@example.invalid', product_code: 'psa' }]);
  await db('users').insert({ tenant: source, user_id: ids.person, username: `source-${ids.person}`, email: `${ids.person}@example.invalid`, hashed_password: 'not-a-login', user_type: 'internal', is_inactive: false });
  await db('clients').insert({ tenant: source, client_id: ids.client, client_name: 'Customer organization' });
  await db('clients').insert({ tenant: other, client_id: ids.otherClient, client_name: 'DO NOT EXPORT' });
  await db('contacts').insert({ tenant: source, contact_name_id: ids.contact, client_id: ids.client, full_name: 'Customer Contact', email: 'primary@example.invalid' });
  await db('contact_phone_numbers').insert({ tenant: source, contact_phone_number_id: ids.phone, contact_name_id: ids.contact, phone_number: '+15551231234', canonical_type: 'work', is_default: true });
  await db('contact_additional_email_addresses').insert({ tenant: source, contact_additional_email_address_id: ids.extraEmail, contact_name_id: ids.contact, email_address: 'secondary@example.invalid', canonical_type: 'work' });
  await db('boards').insert({ tenant: source, board_id: ids.board, board_name: 'Service Desk' });
  await db('statuses').insert({ tenant: source, status_id: ids.ticketStatus, name: 'Open', status_type: 'ticket', item_type: 'ticket', order_number: 0, board_id: ids.board });
  await db('tickets').insert({ tenant: source, ticket_id: ids.ticket, ticket_number: 'T-1', title: 'Help desk request', client_id: ids.client, board_id: ids.board, status_id: ids.ticketStatus, entered_by: ids.person, attributes: { description: 'Original ticket description' } });
  await db('comment_threads').insert({ tenant: source, thread_id: ids.thread, root_comment_id: ids.rootComment, ticket_id: ids.ticket, is_internal: false, collaboration_audience: 'requester', created_by: ids.person });
  await db('comments').insert({ tenant: source, comment_id: ids.rootComment, ticket_id: ids.ticket, thread_id: ids.thread, user_id: ids.person, note: 'Customer message', is_internal: false, is_resolution: false });
  await db('comments').insert({ tenant: source, comment_id: ids.replyComment, ticket_id: ids.ticket, thread_id: ids.thread, parent_comment_id: ids.rootComment, user_id: ids.person, note: 'Reply message', is_internal: false, is_resolution: false });
  await db('comments').insert({ tenant: source, comment_id: ids.scheduledComment, ticket_id: ids.ticket, thread_id: ids.thread, user_id: ids.person, note: 'Future message', is_internal: false, is_resolution: false, publish_state: 'scheduled', scheduled_publish_at: new Date(Date.now() + 3600_000) });
  await db('comment_threads').where({ tenant: source, thread_id: ids.thread }).update({ root_comment_id: ids.rootComment });
  await db('asset_type_registry').insert({ tenant: source, type_id: ids.assetKind, slug: 'workstation', name: 'Workstation', fields_schema: JSON.stringify([{ key: 'rack', label: 'Rack', kind: 'text' }]), is_builtin: true });
  await db('assets').insert({ tenant: source, asset_id: ids.asset, asset_tag: `asset-${ids.asset}`, name: 'Customer laptop', status: 'active', client_id: ids.client, asset_type: 'workstation', contact_name_id: ids.contact, warranty_end_date: '2027-11-01', attributes: { rack: 'R-23' } });
  await db('workstation_assets').insert({ tenant: source, asset_id: ids.asset, os_type: 'Linux', cpu_model: 'Example CPU', cpu_cores: 4, ram_gb: 16 });
  await db('statuses').insert({ tenant: source, status_id: ids.status, name: 'Active', status_type: 'project', item_type: 'project', order_number: 0 });
  await db('projects').insert({ tenant: source, project_id: ids.project, project_name: 'Deployment', client_id: ids.client, status: ids.status, project_number: 'P-1', wbs_code: '1' });
  await db('project_phases').insert({ tenant: source, phase_id: ids.phase, project_id: ids.project, phase_name: 'Build', status: 'pending', order_number: 0, wbs_code: '1.1' });
  await db('project_tasks').insert({ tenant: source, task_id: ids.task, phase_id: ids.phase, task_name: 'Configure', wbs_code: '1.1.1' });
  await db('time_periods').insert({ tenant: source, period_id: ids.period, start_date: '2026-11-01', end_date: '2026-11-07' });
  await db('time_sheets').insert({ tenant: source, id: ids.sheet, user_id: ids.person, period_id: ids.period });
  await db('time_entries').insert({ tenant: source, entry_id: ids.time, user_id: ids.person, time_sheet_id: ids.sheet, start_time: '2026-11-02T10:00:00Z', end_time: '2026-11-02T11:00:00Z', work_date: '2026-11-02', work_timezone: 'UTC', work_item_id: ids.task, work_item_type: 'project_task', billing_mode: 'operational', notes: 'Deployment effort' });
  await db('schedule_entries').insert({ tenant: source, entry_id: ids.calendar, title: 'Install window', scheduled_start: '2026-11-03T10:00:00Z', scheduled_end: '2026-11-03T11:00:00Z', status: 'scheduled', work_item_type: 'project_task', work_item_id: ids.task });
  await db('interaction_types').insert({ tenant: source, type_id: ids.interactionKind, type_name: 'Call' });
  await db('interactions').insert({ tenant: source, interaction_id: ids.interaction, type_id: ids.interactionKind, user_id: ids.person, title: 'Customer review', client_id: ids.client });
  await db('online_meetings').insert({ tenant: source, meeting_id: ids.meeting, subject: 'Review meeting', start_time: '2026-11-03T10:00:00Z', end_time: '2026-11-03T11:00:00Z', interaction_id: ids.interaction, provider: 'teams', provider_meeting_id: 'SECRET-PROVIDER-BINDING' });
  const storagePath = `${source}/uploads/${ids.file}`; objects.set(storagePath, bytes);
  await db('external_files').insert({ tenant: source, file_id: ids.file, file_name: ids.file, original_name: 'guide.txt', mime_type: 'text/plain', file_size: bytes.length, storage_path: storagePath, uploaded_by_id: ids.person });
  await db('documents').insert({ tenant: source, document_id: ids.document, document_name: 'Runbook', user_id: ids.person, created_by: ids.person, file_id: ids.file, content: `Runbook [download](/api/documents/download/${ids.file}?temporary=secret#guide) and \`/api/documents/download/${ids.file}\`` });
  await db('kb_articles').insert({ tenant: source, article_id: ids.article, document_id: ids.document, slug: 'runbook', audience: 'internal', status: 'draft' });
  await db('workflow_definitions').insert({ tenant: source, workflow_id: ids.workflow, name: 'Review procedure', payload_schema_ref: 'payload.Empty.v1', draft_definition: { steps: [] }, trigger: { type: 'event', eventName: 'TICKET_CREATED' }, is_paused: false });
  const folderParent = `ffffffff-${randomUUID().slice(9)}`, folderChild = `00000000-${randomUUID().slice(9)}`;
  await db('document_folders').insert({ tenant: source, folder_id: folderParent, folder_name: 'Parent folder', folder_path: 'Parent' });
  await db('document_folders').insert({ tenant: source, folder_id: folderChild, parent_folder_id: folderParent, folder_name: 'Child folder', folder_path: 'Parent/Child' });
  await db('teams').insert({ tenant: source, team_id: ids.team, team_name: 'Customer IT' });
  await db('team_members').insert({ tenant: source, team_id: ids.team, user_id: ids.person });
  await db('roles').insert({ tenant: source, role_id: ids.role, role_name: 'Workspace admin', msp: true });
  await db('permissions').insert({ tenant: source, permission_id: ids.permission, resource: 'co_management', action: 'manage', msp: true });
  await db('role_permissions').insert({ tenant: source, role_id: ids.role, permission_id: ids.permission });
  await db('user_roles').insert({ tenant: source, user_id: ids.person, role_id: ids.role });
  await db('sessions').insert({ tenant: source, session_id: ids.session, user_id: ids.person, expires_at: new Date(Date.now() + 3600_000) });
  await db('co_management_relationships').insert({ tenant: source, relationship_id: ids.relationship, sponsor_tenant: other, sponsor_client_id: ids.otherClient, state: 'active', accepted_at: db.fn.now(), accepted_by: ids.person });
  for (const [attachmentId, customer, name, content] of [[ids.conversationFile, source, 'conversation.txt', Buffer.from('conversation bytes')], [ids.privateFile, other, 'MSP PRIVATE FILE', Buffer.from('MSP-private bytes')]] as const) {
    const path = `co-management/${source}/${attachmentId}`; objects.set(path, content);
    const digest = createHash('sha256').update(content).digest('hex');
    await db('co_management_conversation_attachments').insert({ tenant: source, attachment_id: attachmentId, customer_tenant: customer, relationship_id: ids.relationship,
      ticket_id: ids.ticket, thread_id: ids.thread, comment_id: ids.rootComment, actor_tenant: source, actor_user_id: ids.person,
      file_name: name, mime_type: 'text/plain', file_size: content.length, content_hash: digest, request_hash: digest, storage_path: path, status: 'ready', ready_at: db.fn.now() });
  }
  await writeFile(packagePath, (await new AmpExportService(db, source).exportWorkspace()).buffer);
  if (process.env.AMP_WORKSPACE_REVIEW_PACKAGE) await copyFile(packagePath, process.env.AMP_WORKSPACE_REVIEW_PACKAGE);
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); await db?.destroy(); });

describe('AMP workspace replacement', () => {
  it('keeps the existing general export within its core-record scope without reading files', async () => {
    reads.clear();
    const path = join(directory, 'core.amp');
    await writeFile(path, (await new AmpExportService(db, source).exportTenant()).buffer);
    expect(validateAmpPackage(path).valid).toBe(true);
    const reader = new AmpSqliteReader(path);
    try {
      expect(reader.allRows('organizations')).toHaveLength(1);
      for (const entity of ['people', 'projects', 'time_records', 'documents', 'files', 'attachments'] as const) expect(reader.allRows(entity)).toHaveLength(0);
      expect(reads.size).toBe(0);
    } finally { reader.close(); }
  });
  it('exports a tenant snapshot with neutral domain records, files and explicit exclusions', async () => {
    const result = await new AmpExportService(db, source).exportWorkspace();
    await writeFile(packagePath, result.buffer);
    expect(validateAmpPackage(packagePath)).toMatchObject({ valid: true });
    const reader = new AmpSqliteReader(packagePath);
    try {
      expect(reader.allRows('organizations').map(row => row.name)).toEqual(['Customer organization']);
      expect(reader.allRows('projects')[0].name).toBe('Deployment');
      expect(reader.allRows('work_items')[0].name).toBe('Configure');
      expect(JSON.stringify(reader.allRows('people'))).not.toContain('not-a-login');
      expect(reader.allRows('time_records')[0].notes).toBe('Deployment effort');
      expect(reader.allRows('meetings')[0].title).toBe('Review meeting');
      expect(reader.allRows('knowledge_articles')[0].slug).toBe('runbook');
      expect(reader.allRows('documents')[0].body).toContain('amp://files/');
      expect(reader.allRows('documents')[0].body).not.toContain('temporary=secret');
      const attachment = reader.allRows('attachments').find(row => row.entity_type === 'files')!;
      expect(reader.allRows('attachments').some(row => row.file_name === 'MSP PRIVATE FILE')).toBe(false);
      expect(readFileSync(reader.attachmentPath(String(attachment.sha256))!)).toEqual(bytes);
      expect(reader.allRows('exclusions')).toContainEqual(expect.objectContaining({ reason: 'secret' }));
      expect(JSON.stringify(reader.allRows('meetings'))).not.toContain('SECRET-PROVIDER-BINDING');
      expect(result.manifest.export_started_at).toBeTruthy(); expect(result.manifest.export_completed_at).toBeTruthy();
    } finally { reader.close(); }
  });
  it('restores through AMP staging and ledger into a safe fresh tenant and resumes idempotently', async () => {
    const service = new AmpWorkspaceImportService(db);
    const input = { packagePath, targetTenant: target, name: 'Restored workspace', email: 'owner@example.invalid' };
    const result = await service.importPackage(input);
    const failures = await db('migration_record_outcomes').where({ tenant: target, action: 'failed' });
    expect(failures.map(row => row.errors)).toEqual([]);
    expect(result.state).toBe('completed');
    const { isTenantSuspended } = await import('@alga-psa/db');
    expect(await isTenantSuspended(db, target)).toBe(true);
    expect(await isTenantSuspended(db, source)).toBe(false);
    expect(await db('tenants').where({ tenant: target }).first()).toMatchObject({ suspended_reason: 'amp_workspace_review' });
    expect(await db('projects').where({ tenant: target }).first()).toMatchObject({ project_name: 'Deployment' });
    const folders = await db('document_folders').where({ tenant: target });
    expect(folders.find(row => row.folder_name === 'Child folder').parent_folder_id).toBe(folders.find(row => row.folder_name === 'Parent folder').folder_id);
    const task = await db('project_tasks').where({ tenant: target }).first();
    const time = await db('time_entries').where({ tenant: target }).first();
    expect(time.work_item_id).toBe(task.task_id); expect(time.user_id).not.toBe(ids.person); expect(time.billable_duration).toBe(0);
    expect(await db('users').where({ tenant: target, is_inactive: false })).toHaveLength(0);
    expect(await db('team_members').where({ tenant: target })).toHaveLength(1);
    expect(await db('user_roles').where({ tenant: target })).toHaveLength(1);
    expect(await db('workflow_definitions').where({ tenant: target }).first()).toMatchObject({ is_paused: true, trigger: { type: 'event', eventName: 'TICKET_CREATED' } });
    expect(await db('schedule_entries').where({ tenant: target }).first()).toMatchObject({ status: 'cancelled', is_recurring: false });
    expect(await db('online_meetings').where({ tenant: target }).first()).toMatchObject({ provider_meeting_id: null });
    const contact = await db('contacts').where({ tenant: target }).first();
    expect(await db('contact_additional_email_addresses').where({ tenant: target, contact_name_id: contact.contact_name_id }).first()).toMatchObject({ email_address: 'secondary@example.invalid' });
    expect(await db('assets').where({ tenant: target }).first()).toMatchObject({ name: 'Customer laptop', contact_name_id: contact.contact_name_id, attributes: { rack: 'R-23' } });
    expect(await db('workstation_assets').where({ tenant: target }).first()).toMatchObject({ cpu_model: 'Example CPU', cpu_cores: 4 });
    expect(await db('comments').where({ tenant: target, note: 'Future message' }).first()).toMatchObject({ publish_state: 'canceled' });
    const conversationFile = await db('ticket_comment_attachments').where({ tenant: target }).first();
    expect(conversationFile.state).toBe('attached');
    const document = await db('documents').where({ tenant: target, document_name: 'Runbook' }).first();
    const file = await db('external_files').where({ tenant: target, file_id: document.file_id }).first();
    expect(file.file_id).not.toBe(ids.file); expect(objects.get(file.storage_path)).toEqual(bytes);
    expect(document.content).toContain(`[download](/api/documents/download/${file.file_id}#guide)`);
    expect(document.content).toContain(`\`/api/documents/download/${ids.file}\``);
    const inspection = await db('migration_reports').where({ tenant: target, migration_job_id: result.migrationJobId, report_type: 'inspection' }).first();
    expect(inspection.summary.exclusions).toContainEqual(expect.objectContaining({ reason: 'secret' }));
    const before = await db('migration_identity_mappings').where({ tenant: target });
    expect((await service.importPackage(input)).state).toBe('completed');
    expect(await db('migration_identity_mappings').where({ tenant: target })).toHaveLength(before.length);
    expect(await db('projects').where({ tenant: target })).toHaveLength(1);
    expect(await db('clients').where({ tenant: other })).toHaveLength(1);
    await expect(service.importPackage({ ...input, targetTenant: other })).rejects.toThrow('already exists');
  });
  it('excludes unreadable files with a reason and no dangling file reference', async () => {
    const key = `${source}/uploads/${ids.file}`; objects.delete(key);
    try {
      const path = join(directory, 'unreadable.amp');
      await writeFile(path, (await new AmpExportService(db, source).exportWorkspace()).buffer);
      expect(validateAmpPackage(path).valid).toBe(true);
      const reader = new AmpSqliteReader(path);
      try {
        expect(reader.allRows('files')).toHaveLength(0);
        expect(reader.allRows('documents')[0].file_package_record_id).toBeNull();
        expect(reader.allRows('exclusions')).toContainEqual(expect.objectContaining({ reason: 'attachment_unreadable' }));
      } finally { reader.close(); }
    } finally { objects.set(key, bytes); }
  });
  it('retains file metadata from the same repeatable-read snapshot as the records', async () => {
    const original = `${source}/uploads/${ids.file}`, changed = `${source}/uploads/changed-after-snapshot`;
    const path = join(directory, 'snapshot.amp');
    reads.clear();
    try {
      const result = await new AmpExportService(db, source).exportWorkspace(async () => {
        await db('external_files').where({ tenant: source, file_id: ids.file }).update({ storage_path: changed });
        await db('documents').where({ tenant: source, document_id: ids.document }).update({ document_name: 'Changed after snapshot' });
      });
      await writeFile(path, result.buffer);
      const reader = new AmpSqliteReader(path);
      try { expect(reader.allRows('documents')[0].name).toBe('Runbook'); expect(reader.allRows('files')).toHaveLength(1); }
      finally { reader.close(); }
      expect(reads.has(original)).toBe(true); expect(reads.has(changed)).toBe(false);
    } finally {
      await db('external_files').where({ tenant: source, file_id: ids.file }).update({ storage_path: original });
      await db('documents').where({ tenant: source, document_id: ids.document }).update({ document_name: 'Runbook' });
    }
  });
  it('never reads a file locator belonging to a different tenant', async () => {
    const otherPath = `${other}/uploads/${randomUUID()}`; objects.set(otherPath, Buffer.from('foreign file bytes'));
    await db('external_files').where({ tenant: source, file_id: ids.file }).update({ storage_path: otherPath });
    try {
      const path = join(directory, 'foreign-locator.amp');
      await writeFile(path, (await new AmpExportService(db, source).exportWorkspace()).buffer);
      expect(reads.has(otherPath)).toBe(false);
      const reader = new AmpSqliteReader(path);
      try { expect(reader.allRows('files')).toHaveLength(0); } finally { reader.close(); }
    } finally {
      await db('external_files').where({ tenant: source, file_id: ids.file }).update({ storage_path: `${source}/uploads/${ids.file}` });
      objects.delete(otherPath);
    }
  });
  it('does not accept fresh-target claims from editable job configuration', async () => {
    const jobId = randomUUID();
    await db('migration_jobs').insert({ tenant: source, migration_job_id: jobId, owner_user_id: ids.person,
      source_file_name: 'workspace.amp', package_sha256: createHash('sha256').update(readFileSync(packagePath)).digest('hex'),
      configuration: { targetPolicies: { createTargetTenant: true, deactivateImportedUsers: true, requireReauthForConnections: true, pauseDispatch: true } } });
    const { MigrationStager } = await import('./MigrationStager');
    await expect(new MigrationStager(db, source).stage(jobId, packagePath)).rejects.toThrow('fresh installation target');
    expect(await db('migration_staged_records').where({ tenant: source, migration_job_id: jobId })).toHaveLength(0);
  });
  it('recovers provider writes after failure and resumes the same isolated AMP job', async () => {
    const targetTenant = randomUUID();
    const input = { packagePath, targetTenant, name: 'Retry target', email: 'retry@example.invalid' };
    const service = new AmpWorkspaceImportService(db);
    transport.failAfterWrite = true;
    expect((await service.importPackage(input)).state).toBe('failed');
    const retained = await db('external_files').where({ tenant: targetTenant });
    expect([...objects.keys()].filter(path => path.startsWith(`${targetTenant}/`)).sort()).toEqual(retained.map(row => row.storage_path).sort());
    await db('migration_staged_attachments').where({ tenant: targetTenant }).update({ expires_at: new Date(Date.now() - 1000) });
    const { cleanupAmpStaging } = await import('./cleanupAmpStaging');
    expect(await cleanupAmpStaging(db, targetTenant)).toBeGreaterThan(0);
    expect((await service.importPackage(input)).state).toBe('completed');
    expect(await db('migration_staged_attachments').where({ tenant: targetTenant })).toHaveLength(0);
    expect(await db('external_files').where({ tenant: targetTenant })).toHaveLength(2);
    expect(await db('projects').where({ tenant: targetTenant })).toHaveLength(1);
  });
  it('imports attachments owned directly by other AMP entities through the same ledger', async () => {
    const reader = new AmpSqliteReader(packagePath);
    const path = join(directory, 'project-attachment.amp'), addedPath = join(directory, 'project.txt');
    const added = Buffer.from('project-owned attachment'), sha256 = createHash('sha256').update(added).digest('hex');
    await writeFile(addedPath, added);
    try {
      const tables = reader.tableNames().filter(table => table !== 'amp_manifest');
      const rows = Object.fromEntries(tables.map(table => [table, reader.allRows(table as import('@alga-psa/migration-spec').AmpTable)]));
      rows.attachments.push({ package_record_id: 'project-attachment', entity_type: 'projects', entity_package_record_id: `projects:${ids.project}`, sha256, size: added.length, file_name: 'project.txt', media_type: 'text/plain' });
      new AmpPackageBuilder(path).write({ ...reader.manifestRows()[0], package_id: randomUUID() }, rows, [
        ...reader.attachmentDigests().map(digest => ({ sha256: digest, size: reader.attachmentSize(digest)!, filePath: reader.attachmentPath(digest)! })),
        { sha256, size: added.length, filePath: addedPath },
      ]);
    } finally { reader.close(); }
    const targetTenant = randomUUID();
    expect((await new AmpWorkspaceImportService(db).importPackage({ packagePath: path, targetTenant, name: 'Other consumer', email: 'consumer@example.invalid' })).state).toBe('completed');
    const document = await db('documents').where({ tenant: targetTenant, document_name: 'project.txt' }).first();
    const link = await db('document_associations').where({ tenant: targetTenant, document_id: document.document_id, entity_type: 'project' }).first();
    expect(link).toBeTruthy();
    const file = await db('external_files').where({ tenant: targetTenant, file_id: document.file_id }).first();
    expect(objects.get(file.storage_path)).toEqual(added);
  });
  it('enforces tenant-local customer-admin RBAC and retained session expiry', async () => {
    const { withCoManagedExportAdmin } = await import('@alga-psa/co-managed/exportAuthorization');
    const actor = { kind: 'session' as const, tenant: source, userId: ids.person, sessionId: ids.session };
    const extract = vi.fn(async () => 'authorized');
    await expect(withCoManagedExportAdmin(db, actor, extract)).resolves.toBe('authorized');
    extract.mockClear();
    await expect(withCoManagedExportAdmin(db, { ...actor, tenant: other }, extract)).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    expect(extract).not.toHaveBeenCalled();
    await db('sessions').where({ tenant: source, session_id: ids.session }).update({ revoked_at: db.fn.now() });
    await expect(withCoManagedExportAdmin(db, actor, extract)).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    expect(extract).not.toHaveBeenCalled();
    await db('sessions').where({ tenant: source, session_id: ids.session }).update({ revoked_at: null });
  });
  it('denies a provisioned domain without a grant before reading any file bytes', async () => {
    const { withCoManagedExportAdmin } = await import('@alga-psa/co-managed/exportAuthorization');
    const { authorizeAmpWorkspaceExport } = await import('../co-managed/ampExportAuthorization');
    const permission = randomUUID();
    await db('permissions').insert({ tenant: source, permission_id: permission, resource: 'document', action: 'read', msp: true });
    reads.clear();
    try {
      await expect(withCoManagedExportAdmin(db, { kind: 'session', tenant: source, userId: ids.person, sessionId: ids.session },
        (trx, actor, subject) => new AmpExportService(trx, source).exportWorkspace((snapshot, rows) => authorizeAmpWorkspaceExport(snapshot, actor, subject, rows))))
        .rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
      expect(reads.size).toBe(0);
    } finally { await db('permissions').where({ tenant: source, permission_id: permission }).delete(); }
  });
  it('retains imported workflow responses as re-exportable historical evidence without recreating executions', async () => {
    const reader = new AmpSqliteReader(packagePath), path = join(directory, 'workflow-history.amp');
    try {
      const rows = Object.fromEntries(reader.tableNames().filter(table => table !== 'amp_manifest').map(table => [table, reader.allRows(table as import('@alga-psa/migration-spec').AmpTable)]));
      const base = { external_identifier_namespace: 'other-consumer', created_at: '2026-11-01T00:00:00Z' };
      rows.workflow_tasks = [{ ...base, package_record_id: 'history-task', source_record_id: 'task', title: 'Review response', state: 'completed', response: '{"approved":true}' }];
      rows.workflow_history = [{ ...base, package_record_id: 'history-event', source_record_id: 'event', task_package_record_id: 'history-task', action: 'completed', state: 'completed' }];
      new AmpPackageBuilder(path).write({ ...reader.manifestRows()[0], package_id: randomUUID() }, rows,
        reader.attachmentDigests().map(sha256 => ({ sha256, size: reader.attachmentSize(sha256)!, filePath: reader.attachmentPath(sha256)! })));
    } finally { reader.close(); }
    const targetTenant = randomUUID();
    expect((await new AmpWorkspaceImportService(db).importPackage({ packagePath: path, targetTenant, name: 'Historical', email: 'history@example.invalid' })).state).toBe('completed');
    expect(await db('workflow_tasks').where({ tenant: targetTenant })).toHaveLength(0);
    const exported = join(directory, 'reexport.amp');
    await writeFile(exported, (await new AmpExportService(db, targetTenant).exportWorkspace()).buffer);
    const check = new AmpSqliteReader(exported);
    try {
      expect(validateAmpPackage(exported).valid).toBe(true);
      expect(check.allRows('workflow_tasks')[0]).toMatchObject({ title: 'Review response', response: '{"approved":true}' });
      expect(check.allRows('workflow_history')[0].task_package_record_id).toBe(check.allRows('workflow_tasks')[0].package_record_id);
    } finally { check.close(); }
  });
  it('rejects the retired archive format before creating a tenant', async () => {
    const path = join(directory, 'retired.alga');
    await writeFile(path, Buffer.concat([Buffer.from('ALGA-WORKSPACE-ARCHIVE\0\x01', 'binary'), Buffer.alloc(24)]));
    const targetTenant = randomUUID();
    await expect(new AmpWorkspaceImportService(db).importPackage({ packagePath: path, targetTenant, name: 'Rejected', email: 'rejected@example.invalid' })).rejects.toThrow('AMP package rejected');
    expect(await db('tenants').where({ tenant: targetTenant })).toHaveLength(0);
  });
  it('honors the kill switch before reading a package or creating a target', async () => {
    const before = process.env.FORCE_CAPABILITIES; process.env.FORCE_CAPABILITIES = 'co-managed:off';
    try { await expect(new AmpWorkspaceImportService(db).importPackage({ packagePath: '/does-not-exist', targetTenant: randomUUID(), name: 'Closed', email: 'closed@example.invalid' })).rejects.toThrow('capability disabled'); }
    finally { if (before == null) delete process.env.FORCE_CAPABILITIES; else process.env.FORCE_CAPABILITIES = before; }
  });
});
