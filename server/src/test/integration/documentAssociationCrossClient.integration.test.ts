import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createClient, createUser } from '../../../test-utils/testDataFactory';
import { createMockUser, setMockUser, setupCommonMocks } from '../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let mspUserId: string;
let clientAId: string;
let clientBId: string;
let clientAUserId: string;
let clientBUserId: string;
let taskAId: string;
let taskBId: string;
let ticketBId: string;
let documentAId: string;
let documentBId: string;
let statusOrder = 0;
let mspStorageProviderId: string;
let mspStorageConfigurationId: string;
let mspUploadedFileId: string;

const dbRef = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '' as string }));
const storageMocks = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  validateFileUpload: vi.fn(async () => undefined),
  deleteFile: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/storage/StorageService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/storage/StorageService')>();
  return {
    ...actual,
    StorageService: {
      ...actual.StorageService,
      uploadFile: storageMocks.uploadFile,
      validateFileUpload: storageMocks.validateFileUpload,
      deleteFile: storageMocks.deleteFile,
    },
  };
});
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  requireTenantId: vi.fn(async () => dbRef.tenant),
  resolveTenantId: vi.fn(async () => dbRef.tenant || null),
}));
vi.mock('server/src/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('server/src/lib/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  getCurrentTenantId: vi.fn(async () => dbRef.tenant || null),
  runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<unknown>) => fn()),
  getConnection: vi.fn(async () => dbRef.knex),
  withTransaction: vi.fn(async <T>(connection: Knex, fn: (trx: Knex.Transaction) => Promise<T>) => connection.transaction(fn)),
}));
vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => dbRef.tenant || null),
  getTenantFromHeaders: vi.fn(() => dbRef.tenant || null),
}));

let searchDocumentAssociationEntities: typeof import('@alga-psa/documents/actions').searchDocumentAssociationEntities;
let createDocumentAssociations: typeof import('@alga-psa/documents/actions').createDocumentAssociations;
let removeDocumentAssociations: typeof import('@alga-psa/documents/actions').removeDocumentAssociations;
let uploadDocument: typeof import('@alga-psa/documents/actions').uploadDocument;
let getClientDocuments: typeof import('@alga-psa/client-portal/actions').getClientDocuments;

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

async function seedProjectTask(clientId: string, taskName: string): Promise<string> {
  const statusId = uuidv4();
  await table('statuses').insert({
    tenant: tenantId, status_id: statusId, name: `Status ${statusId.slice(0, 6)}`,
    status_type: 'project', item_type: 'project', is_closed: false, order_number: 10_000 + statusOrder++, created_by: mspUserId,
  });
  const projectId = uuidv4();
  await table('projects').insert({
    tenant: tenantId, project_id: projectId, client_id: clientId, project_name: `Project ${taskName}`,
    wbs_code: `wbs-${projectId}`, project_number: `P-${projectId.slice(0, 8)}`, status: statusId, is_inactive: false,
  });
  const mappingId = uuidv4();
  await table('project_status_mappings').insert({
    tenant: tenantId, project_status_mapping_id: mappingId, project_id: projectId, status_id: statusId,
    is_standard: false, display_order: 1, is_visible: true,
  });
  const phaseId = uuidv4();
  await table('project_phases').insert({
    tenant: tenantId, phase_id: phaseId, project_id: projectId, phase_name: `Phase ${taskName}`,
    wbs_code: `phase-${phaseId}`, status: 'active', order_number: 1,
  });
  const taskId = uuidv4();
  await table('project_tasks').insert({
    tenant: tenantId, task_id: taskId, phase_id: phaseId, project_status_mapping_id: mappingId,
    task_name: taskName, wbs_code: `task-${taskId}`,
  });
  return taskId;
}

async function seedDocument(clientId = clientAId, createdBy = clientAUserId, name = 'Client A document'): Promise<string> {
  const id = uuidv4();
  await table('documents').insert({
    tenant: tenantId, document_id: id, document_name: name, created_by: createdBy,
    user_id: createdBy, entered_at: new Date(), updated_at: new Date(), is_client_visible: true,
  });
  await table('document_associations').insert({
    tenant: tenantId, association_id: uuidv4(), document_id: id, entity_type: 'client', entity_id: clientId,
    created_at: new Date(),
  });
  return id;
}

describe('document association cross-client authorization', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';
    db = await createTestDbConnection();
    tenantId = await createTenant(db, 'Document Association Security Test Tenant');
    dbRef.knex = db;
    dbRef.tenant = tenantId;
    mspUserId = await createUser(db, tenantId, { username: `msp-${uuidv4().slice(0, 8)}` });
    clientAId = await createClient(db, tenantId, 'Association Client A');
    clientBId = await createClient(db, tenantId, 'Association Client B');
    const contactAId = uuidv4();
    await table('contacts').insert({ tenant: tenantId, contact_name_id: contactAId, client_id: clientAId, full_name: 'Client A User' });
    clientAUserId = uuidv4();
    await table('users').insert({
      tenant: tenantId, user_id: clientAUserId, username: `client-${clientAUserId.slice(0, 8)}`,
      email: `${clientAUserId}@test.com`, hashed_password: 'test', user_type: 'client', contact_id: contactAId,
      first_name: 'Client', last_name: 'A', is_inactive: false,
    });
    const contactBId = uuidv4();
    await table('contacts').insert({ tenant: tenantId, contact_name_id: contactBId, client_id: clientBId, full_name: 'Client B User' });
    clientBUserId = uuidv4();
    await table('users').insert({
      tenant: tenantId, user_id: clientBUserId, username: `client-${clientBUserId.slice(0, 8)}`,
      email: `${clientBUserId}@test.com`, hashed_password: 'test', user_type: 'client', contact_id: contactBId,
      first_name: 'Client', last_name: 'B', is_inactive: false,
    });
    taskAId = await seedProjectTask(clientAId, 'Client A task');
    taskBId = await seedProjectTask(clientBId, 'Client B secret task');
    ticketBId = uuidv4();
    await table('tickets').insert({
      tenant: tenantId, ticket_id: ticketBId, ticket_number: `B-${ticketBId.slice(0, 6)}`,
      title: 'Client B secret ticket', client_id: clientBId, entered_by: mspUserId, entered_at: new Date(),
      updated_at: new Date(), attributes: {},
    });
    documentAId = await seedDocument();
    documentBId = await seedDocument(clientBId, mspUserId, 'Client B document');
    await table('document_associations').insert({
      tenant: tenantId, association_id: uuidv4(), document_id: documentBId, entity_type: 'project_task', entity_id: taskBId,
      created_at: new Date(),
    });
    ({ searchDocumentAssociationEntities, createDocumentAssociations, removeDocumentAssociations, uploadDocument } =
      await import('@alga-psa/documents/actions'));
    ({ getClientDocuments } = await import('@alga-psa/client-portal/actions'));
  }, 120_000);

  afterAll(async () => { await db?.destroy(); });

  afterEach(async () => {
    if (!db || !tenantId) return;
    await table('document_associations').where({ document_id: documentAId }).del();
    await table('documents').where({ document_id: documentAId }).del();
    await table('document_associations').where({ document_id: documentBId }).del();
    await table('documents').where({ document_id: documentBId }).del();
    const uploadedDocuments = await table('documents').where({ created_by: mspUserId, document_name: 'msp-cross-client.txt' }).select('document_id');
    const uploadedIds = uploadedDocuments.map((document: { document_id: string }) => document.document_id);
    if (uploadedIds.length) {
      await table('document_associations').whereIn('document_id', uploadedIds).del();
      await table('documents').whereIn('document_id', uploadedIds).del();
    }
    await table('external_files').where({ file_id: mspUploadedFileId }).del();
    await table('document_folders').whereIn('entity_id', [taskAId, taskBId]).del();
    await table('storage_configurations').where({ configuration_id: mspStorageConfigurationId }).del();
    await table('storage_providers').where({ provider_id: mspStorageProviderId }).del();
    await table('document_associations').whereIn('entity_id', [taskAId, taskBId, ticketBId]).del();
    await table('tickets').where({ ticket_id: ticketBId }).del();
    const projects = await table('projects').whereIn('client_id', [clientAId, clientBId]).pluck('project_id');
    const phases = projects.length
      ? await table('project_phases').whereIn('project_id', projects).select('phase_id')
      : [];
    const taskIds = phases.length ? await table('project_tasks').whereIn('phase_id', phases.map((phase: { phase_id: string }) => phase.phase_id)).pluck('task_id') : [];
    if (taskIds.length) await table('project_tasks').whereIn('task_id', taskIds).del();
    await table('project_phases').whereIn('phase_id', phases.map((phase: { phase_id: string }) => phase.phase_id)).del();
    if (projects.length) await table('project_status_mappings').whereIn('project_id', projects).del();
    await table('projects').whereIn('project_id', projects).del();
    await table('statuses').where('created_by', mspUserId).andWhere('status_type', 'project').del();
    await table('users').where({ user_id: clientAUserId }).del();
    await table('users').where({ user_id: clientBUserId }).del();
    await table('contacts').whereIn('client_id', [clientAId, clientBId]).del();
    await table('clients').whereIn('client_id', [clientAId, clientBId]).del();
  });

  it('scopes search counts and rejects cross-client attach, upload, and removal without persisted changes', async () => {
    const clientUser = createMockUser('client', {
      user_id: clientAUserId, tenant: tenantId, clientId: clientAId,
      contact_id: undefined,
    });
    setMockUser(clientUser, [
      'document:read', 'document:create', 'document:update', 'client:read', 'contact:read', 'ticket:read',
      'asset:read', 'project:read', 'project:update', 'contract:read', 'opportunity:read', 'quote:read',
    ]);
    setupCommonMocks({ tenantId, userId: clientAUserId, user: clientUser, permissionCheck: () => true });


    const hiddenTask = await searchDocumentAssociationEntities('project_task', 'Client B secret task', 1, 50);
    expect(hiddenTask).toEqual({ options: [], total: 0 });
    const ownTask = await searchDocumentAssociationEntities('project_task', 'Client A task', 1, 50);
    expect(ownTask.options.map((item: { value: string }) => item.value)).toContain(taskAId);
    const hiddenClient = await searchDocumentAssociationEntities('client', 'Association Client B', 1, 50);
    expect(hiddenClient).toEqual({ options: [], total: 0 });
    const hiddenTicket = await searchDocumentAssociationEntities('ticket', 'Client B secret ticket', 1, 50);
    expect(hiddenTicket).toEqual({ options: [], total: 0 });

    expect(await createDocumentAssociations(taskAId, 'project_task', [documentAId])).toEqual({ success: true });
    expect(await table('document_associations').where({ document_id: documentAId, entity_id: taskAId })).toHaveLength(1);
    expect(await removeDocumentAssociations(taskAId, 'project_task', [documentAId])).toEqual({ success: true });

    const deniedDocumentAssociation = await createDocumentAssociations(taskAId, 'project_task', [documentBId]);
    expect(deniedDocumentAssociation).toHaveProperty('permissionError');
    const bDocumentAssociationsBeforeRemove = await table('document_associations')
      .where({ document_id: documentBId, entity_type: 'project_task', entity_id: taskBId }).select('association_id');
    const deniedDocumentRemoval = await removeDocumentAssociations(taskBId, 'project_task', [documentBId]);
    expect(deniedDocumentRemoval).toHaveProperty('permissionError');
    expect(await table('document_associations')
      .where({ document_id: documentBId, entity_type: 'project_task', entity_id: taskBId }).select('association_id'))
      .toEqual(bDocumentAssociationsBeforeRemove);

    const beforeAssociations = await table('document_associations').select('association_id', 'entity_id', 'entity_type').where({ document_id: documentAId });
    const createResult = await createDocumentAssociations(taskBId, 'project_task', [documentAId]);
    expect(createResult).toHaveProperty('permissionError');
    const removeResult = await removeDocumentAssociations(taskBId, 'project_task', [documentAId]);
    expect(removeResult).toHaveProperty('permissionError');

    const form = new FormData();
    form.set('file', new File(['cross-client upload'], 'cross-client.txt', { type: 'text/plain' }));
    const uploadResult = await uploadDocument(form, { userId: clientAUserId, projectTaskId: taskBId });
    expect(uploadResult).toHaveProperty('permissionError');
    expect(await table('documents').where({ created_by: clientAUserId, document_name: 'cross-client.txt' })).toHaveLength(0);
    expect(await table('document_folders').where({ entity_id: taskBId })).toHaveLength(0);
    expect(await table('document_associations').select('association_id', 'entity_id', 'entity_type').where({ document_id: documentAId })).toEqual(beforeAssociations);

    const clientBUser = createMockUser('client', { user_id: clientBUserId, tenant: tenantId, clientId: clientBId, contact_id: undefined });
    setMockUser(clientBUser, ['document:read']);
    setupCommonMocks({ tenantId, userId: clientBUser.user_id, user: clientBUser, permissionCheck: () => true });
    const clientDocuments = await getClientDocuments(1, 20, {});
    expect(clientDocuments.documents.map((document: { document_id: string }) => document.document_id)).not.toContain(documentAId);

    const mspUser = createMockUser('internal', { user_id: mspUserId, tenant: tenantId });
    setMockUser(mspUser, ['document:read', 'document:create', 'document:update', 'project:read', 'project:update']);
    setupCommonMocks({ tenantId, userId: mspUserId, user: mspUser, permissionCheck: () => true });
    const mspTasks = await searchDocumentAssociationEntities('project_task', '', 1, 50);
    expect(mspTasks.total).toBeGreaterThanOrEqual(2);
    expect(mspTasks.options.map((item: { value: string }) => item.value)).toEqual(expect.arrayContaining([taskAId, taskBId]));
    expect(await createDocumentAssociations(taskBId, 'project_task', [documentAId])).toEqual({ success: true });
    expect(await table('document_associations').where({ document_id: documentAId, entity_id: taskBId })).toHaveLength(1);

    mspStorageProviderId = uuidv4();
    mspStorageConfigurationId = uuidv4();
    mspUploadedFileId = uuidv4();
    await table('storage_providers').insert({
      tenant: tenantId, provider_id: mspStorageProviderId, provider_type: 'local', provider_name: 'Association test storage', config: {},
    });
    await table('storage_configurations').insert({
      tenant: tenantId, configuration_id: mspStorageConfigurationId, provider_id: mspStorageProviderId,
      name: 'Association test storage', path: '/', is_default: true,
    });
    await table('external_files').insert({
      tenant: tenantId, file_id: mspUploadedFileId,
      file_name: 'msp-cross-client.txt', original_name: 'msp-cross-client.txt', mime_type: 'text/plain',
      file_size: 22, storage_path: `test/${mspUploadedFileId}`, uploaded_by_id: mspUserId,
    });
    storageMocks.uploadFile.mockResolvedValue({ file_id: mspUploadedFileId, storage_path: `test/${mspUploadedFileId}` });
    const uploadForm = new FormData();
    uploadForm.set('file', new File(['MSP cross-client upload'], 'msp-cross-client.txt', { type: 'text/plain' }));
    const authorizedUpload = await uploadDocument(uploadForm, { userId: mspUserId, projectTaskId: taskBId });
    expect(authorizedUpload).toHaveProperty('success', true);
    const uploaded = await table('documents').where({ created_by: mspUserId, document_name: 'msp-cross-client.txt' }).first();
    expect(uploaded).toBeDefined();
    if (!uploaded) throw new Error('Expected authorized MSP upload to persist its document');
    expect(await table('document_associations').where({ document_id: uploaded.document_id, entity_id: taskBId })).toHaveLength(1);
  });
});
