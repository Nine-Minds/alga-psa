import { beforeEach, describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({ tables: [] as string[], row: null as any }));
vi.mock('@alga-psa/db', () => {
  const chain = (table: string): any => new Proxy(function () {}, {
    get: (_t, prop) => prop === 'first' ? async () => seen.row : prop === 'then' ? undefined : () => chain(table),
    apply: () => chain(table),
  });
  return { tenantDb: () => ({ table: (name: string) => { seen.tables.push(name); return chain(name); } }) };
});

import { resolveAttachmentAccess } from '../conversationAttachments';
import { assertCoManagedAttachmentPath, disclosedAttachmentPath } from '../attachmentStoragePath';
import { coManagedAttachmentParent, isRegisteredAttachmentThreadKind, registerAttachmentThreadKind, resetAttachmentThreadKinds } from '../attachmentParent';
import { COMMENT_DISCLOSURE_FILE_CAP } from '../threadDisclosureAdmission';
import { attachmentRedactionPolicy } from '../attachmentExport';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AUTHOR = U(1), CUSTOMER = U(2), OTHER = U(3), FILE = U(9);
const ctx = (audience: any, store: string, reader: { tenant: string; requester: boolean }) => ({
  trx: { isTransaction: true } as any, audience, reader, resource: { tenant: CUSTOMER, id: U(5), kind: 'ticket' as const },
  comment: { storeTenant: store, threadId: U(6), commentId: U(7) } });
const row = (store: string) => ({ tenant: store, attachment_id: FILE, storage_path: `co-management/${store}/${FILE}` });

beforeEach(() => { seen.tables = []; seen.row = null; });

describe('A1 audience inheritance behind one resolveAttachmentAccess', () => {
  // [audience, store tenant, reader, readable]
  const matrix: Array<[string, string, { tenant: string; requester: boolean }, boolean]> = [
    ['requester', CUSTOMER, { tenant: CUSTOMER, requester: true }, true],     // portal route
    ['requester', CUSTOMER, { tenant: AUTHOR, requester: false }, true],      // MSP route
    ['shared_it', CUSTOMER, { tenant: CUSTOMER, requester: true }, false],    // requester link denied
    ['shared_it', CUSTOMER, { tenant: AUTHOR, requester: false }, true],
    ['organization_private', AUTHOR, { tenant: AUTHOR, requester: false }, true],
    ['organization_private', AUTHOR, { tenant: CUSTOMER, requester: false }, false],
    ['organization_private', AUTHOR, { tenant: CUSTOMER, requester: true }, false],
    ['organization_private', AUTHOR, { tenant: OTHER, requester: false }, false],
  ];
  it.each(matrix)('%s in %s read as %j -> %s', async (audience, store, reader, readable) => {
    seen.row = row(store);
    const result = resolveAttachmentAccess(ctx(audience, store, reader), FILE);
    if (readable) expect((await result).attachment_id).toBe(FILE); else await expect(result).rejects.toBeTruthy();
    // A denied audience never reaches the database at all.
    if (!readable) expect(seen.tables).toEqual([]);
  });
  it('denies an unpublished or absent file, a non-transaction and a malformed id', async () => {
    await expect(resolveAttachmentAccess(ctx('requester', CUSTOMER, { tenant: CUSTOMER, requester: true }), FILE)).rejects.toBeTruthy();
    await expect(resolveAttachmentAccess({ ...ctx('requester', CUSTOMER, { tenant: CUSTOMER, requester: true }), trx: {} as any }, FILE)).rejects.toBeTruthy();
    await expect(resolveAttachmentAccess(ctx('requester', CUSTOMER, { tenant: CUSTOMER, requester: true }), 'nope')).rejects.toBeTruthy();
  });
  it('refuses a row whose storage path is not the one derived from tenant and id', async () => {
    seen.row = { ...row(CUSTOMER), storage_path: 'documents/other' };
    await expect(resolveAttachmentAccess(ctx('requester', CUSTOMER, { tenant: CUSTOMER, requester: true }), FILE)).rejects.toBeTruthy();
  });
});

describe('A2 own table, no documents row', () => {
  it('resolves through the attachment table only and keeps the author tenant path', async () => {
    seen.row = row(AUTHOR);
    await resolveAttachmentAccess(ctx('organization_private', AUTHOR, { tenant: AUTHOR, requester: false }), FILE);
    expect(seen.tables.every(name => name.startsWith('co_management_conversation_'))).toBe(true);
    expect(seen.tables.some(name => /^(documents|document_)/.test(name))).toBe(false);
    expect(assertCoManagedAttachmentPath(row(AUTHOR))).toBe(`co-management/${AUTHOR}/${FILE}`);
  });
  it('disclosed files live under the customer tenant with a purpose-separated path', () => {
    const op = U(8), path = disclosedAttachmentPath(CUSTOMER, AUTHOR, op, FILE);
    expect(path).toBe(`co-management/${CUSTOMER}/disclosures/${AUTHOR}/${op}/${FILE}`);
    expect(assertCoManagedAttachmentPath({ tenant: CUSTOMER, attachment_id: FILE, storage_path: path, disclosure_operation_id: op, disclosure_sponsor_tenant: AUTHOR })).toBe(path);
    expect(() => assertCoManagedAttachmentPath({ tenant: CUSTOMER, attachment_id: FILE, storage_path: path })).toThrow();
  });
});

describe('thread kind registry and L7b3 export policy', () => {
  it('ships ticket only; a task kind is registered by L4c, not here', () => {
    resetAttachmentThreadKinds();
    expect(isRegisteredAttachmentThreadKind('ticket')).toBe(true);
    expect(isRegisteredAttachmentThreadKind('project_task')).toBe(false);
    expect(() => coManagedAttachmentParent({ kind: 'project_task', id: U(5) })).toThrow();
    expect(coManagedAttachmentParent({ id: U(5) })).toEqual({ ticket_id: U(5), project_task_id: null });
    registerAttachmentThreadKind('project_task', 'project_task_id');
    expect(coManagedAttachmentParent({ kind: 'project_task', id: U(5) })).toEqual({ ticket_id: null, project_task_id: U(5) });
    resetAttachmentThreadKinds();
  });
  it('caps a disclosure at 20 files', () => { expect(COMMENT_DISCLOSURE_FILE_CAP).toBe(20); });
  it('exposes a redaction policy that never throws on unknown rows', () => {
    expect(() => attachmentRedactionPolicy({ purged_at: '2026-01-01' } as any)).not.toThrow();
  });
});
