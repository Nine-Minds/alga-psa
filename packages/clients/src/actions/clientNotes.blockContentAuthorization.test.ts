import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: null as any,
  contact: null as any,
  document: { document_id: 'note-document', updated_at: 'now' } as any,
  writes: [] as Array<{ table: string; value: unknown }>,
  getBlockContent: vi.fn(),
  updateBlockContent: vi.fn(),
  createBlockDocument: vi.fn(),
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  assertMspPermission: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({ withAuth: (action: Function) => action }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: { fn: { now: () => 'now' } } }),
  withTransaction: async (_knex: unknown, callback: (trx: unknown) => unknown) => callback({}),
  tenantDb: (_connection: unknown, _tenant: string) => ({
    table: (tableName: string) => {
      const query: any = {
        where: () => query,
        select: () => query,
        first: async () => {
          if (tableName === 'clients') return mocks.client;
          if (tableName === 'contacts') return mocks.contact;
          if (tableName === 'documents') return mocks.document;
          return undefined;
        },
        update: async (value: unknown) => {
          mocks.writes.push({ table: tableName, value });
          return 1;
        },
      };
      return query;
    },
  }),
}));
vi.mock('@alga-psa/block-content/actions/blockContentActions', () => ({
  getBlockContent: mocks.getBlockContent,
  updateBlockContent: mocks.updateBlockContent,
  createBlockDocument: mocks.createBlockDocument,
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: mocks.publishEvent,
  publishWorkflowEvent: mocks.publishWorkflowEvent,
}));
vi.mock('@alga-psa/workflow-streams', () => ({ buildNoteCreatedPayload: (payload: unknown) => payload }));
vi.mock('../lib/authHelpers', () => ({ assertMspPermission: mocks.assertMspPermission }));
vi.mock('../../lib/authHelpers', () => ({ assertMspPermission: mocks.assertMspPermission }));

import { getClientNoteContent, saveClientNote } from './clientNoteActions';
import { getContactNoteContent, saveContactNote } from './contact-actions/contactNoteActions';

const user = { user_id: 'authenticated-user', tenant: 'tenant-a' } as any;
const invoke = (action: any, ...args: any[]) => action(...args);
const denied = { permissionError: 'Permission denied: Cannot update documents' };

const cases = [
  {
    name: 'client',
    id: 'client-a',
    setEntity: (row: any) => { mocks.client = row; },
    getContent: getClientNoteContent,
    save: saveClientNote,
    row: { client_id: 'client-a', client_name: 'Client A', notes_document_id: 'note-document' },
    newRow: { client_id: 'client-a', client_name: 'Client A', notes_document_id: null },
  },
  {
    name: 'contact',
    id: 'contact-a',
    setEntity: (row: any) => { mocks.contact = row; },
    getContent: getContactNoteContent,
    save: saveContactNote,
    row: { contact_name_id: 'contact-a', full_name: 'Contact A', notes_document_id: 'note-document' },
    newRow: { contact_name_id: 'contact-a', full_name: 'Contact A', notes_document_id: null },
  },
];

describe.each(cases)('$name note block-content authorization propagation', testCase => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.client = null;
    mocks.contact = null;
    mocks.document = { document_id: 'note-document', updated_at: 'now' };
    mocks.writes.length = 0;
    mocks.assertMspPermission.mockResolvedValue(undefined);
    mocks.getBlockContent.mockResolvedValue(denied);
    mocks.updateBlockContent.mockResolvedValue(denied);
    mocks.createBlockDocument.mockResolvedValue(denied);
  });

  it('returns denied reads instead of treating them as empty notes', async () => {
    testCase.setEntity(testCase.row);

    const result = await invoke(testCase.getContent, user, { tenant: 'tenant-a' }, testCase.id);

    expect(result).toEqual(denied);
  });

  it('returns denied updates without publishing success events', async () => {
    testCase.setEntity(testCase.row);

    const result = await invoke(testCase.save, user, { tenant: 'tenant-a' }, testCase.id, { body: 'new note' });

    expect(result).toEqual(denied);
    expect(mocks.publishEvent).not.toHaveBeenCalled();
    expect(mocks.publishWorkflowEvent).not.toHaveBeenCalled();
    expect(mocks.writes).toHaveLength(0);
  });

  it('returns denied creation before changing the entity link or publishing events', async () => {
    testCase.setEntity(testCase.newRow);

    const result = await invoke(testCase.save, user, { tenant: 'tenant-a' }, testCase.id, { body: 'new note' });

    expect(result).toEqual(denied);
    expect(mocks.writes).toHaveLength(0);
    expect(mocks.publishEvent).not.toHaveBeenCalled();
    expect(mocks.publishWorkflowEvent).not.toHaveBeenCalled();
  });
});
