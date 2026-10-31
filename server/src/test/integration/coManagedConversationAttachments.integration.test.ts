/**
 * CM L4b: conversation attachments, drafts and thread disclosure, end to end on the real schema.
 *
 * Same world as commentAudience.crossTenant: a ticket-owning tenant (psa) with a portal requester
 * and a technician, shared with a co_managed workspace whose IT member (Alice) comments; a second
 * workspace member (Bob, another organization) is the "other org" reader.
 *
 *  A1/A2  audience x reader on real rows, through both transports (staff/IT engine and the
 *         requester's portal engine); no `documents` row ever exists; the generic document lookups
 *         do not find an attachment id.
 *  A3     drafts: begin -> reload -> upload -> publish exactly once; discard; sweeper idempotence.
 *  A4     thread disclosure: preview snapshot, concurrent-edit conflicts, same-tenant relabel,
 *         private -> shared byte copy with matching hashes, injected mid-copy failure, 20-file cap.
 *
 * Stand-ins (identical to commentAudience.crossTenant): the shared-work admission wrappers, session
 * expiry, lifecycle admission, private-participation evidence, event/live-update transport and the
 * portal session seam. Object storage is an in-memory map behind the same upload/download seams the
 * production adapters use. Every table, state machine, audience predicate and path assertion is real.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createHash, randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

let currentUser: any;
let testDb: Knex;

const admit = async (db: Knex, actor: any, resource: any, action: string, work: (context: any) => Promise<unknown>) => {
  const run = (trx: Knex.Transaction) => work({ trx, actor: { tenant: actor.tenant, userId: actor.userId }, sessionId: actor.sessionId, action, resource, redactedFields: [] });
  return (db as any).isTransaction ? run(db as Knex.Transaction) : db.transaction(run);
};
vi.mock('../../../../packages/co-managed/src/sharedWork', async importOriginal => ({ ...(await importOriginal<any>()), withCoManagedSharedWork: admit }));
vi.mock('../../../../packages/co-managed/src/customerWork', async importOriginal => ({ ...(await importOriginal<any>()), withCoManagedCustomerTicket: admit }));
vi.mock('../../../../packages/co-managed/src/privateParticipationEvidence', () => ({ retainCoManagedPrivateParticipation: async () => {} }));
vi.mock('../../../../packages/co-managed/src/sharedWorkIdentity', async importOriginal => ({ ...(await importOriginal<any>()), assertCoManagedSessionUnexpired: async () => {} }));
vi.mock('@alga-psa/licensing/lifecycle', async importOriginal => ({ ...(await importOriginal<any>()), assertCoManagedOperationalWrite: async () => {} }));
vi.mock('@alga-psa/event-bus/publishers', async importOriginal => ({ ...(await importOriginal<any>()), publishStoredWorkflowEvent: vi.fn(), publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/tickets/lib/liveUpdates', async importOriginal => ({ ...(await importOriginal<any>()), publishTicketUpdate: vi.fn() }));
vi.mock('@alga-psa/user-composition/actions/avatarActions', () => ({ getUserAvatarUrlAction: async () => null, getContactAvatarUrlAction: async () => null }));
vi.mock('@alga-psa/auth', async importOriginal => ({
  ...(await importOriginal<any>()),
  withAuth: (action: any) => async (...args: any[]) => action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: async () => true,
}));
vi.mock('../../lib/actions/coManagedConversationDraftActions', () => ({ beginCoManagedConversationDraftAction: vi.fn(), uploadCoManagedDraftAttachmentAction: vi.fn(), publishCoManagedConversationDraftAction: vi.fn() }));
vi.mock('@alga-psa/db', async importOriginal => ({
  ...(await importOriginal<any>()),
  getConnection: async () => testDb,
  createTenantKnex: async (tenant?: string) => ({ knex: testDb, tenant: tenant ?? currentUser?.tenant }),
}));

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const objects = new Map<string, Uint8Array>();
const putObject = async (path: string, content: Uint8Array) => { objects.set(path, Buffer.from(content)); };
const getObject = async (path: string) => { const found = objects.get(path); if (!found) throw new Error(`no object at ${path}`); return found; };
const MARK = uuidv4().slice(0, 8);
const file = (name: string, size = 64, mimeType = 'application/pdf') => { const bytes = randomBytes(size); return { name, mimeType, bytes, hash: sha(bytes), id: uuidv4() }; };
type TestFile = ReturnType<typeof file>;

interface Persona { actor: any; resource: any }
let db: Knex;
const tenants: string[] = [];
let msp: { tenant: string; clientId: string; contactId: string; portalUserId: string; techId: string; ticketId: string };
let customer: string, other: string, relationshipId: string, aliceId: string, bobId: string;
let alice: Persona, bob: Persona, tech: Persona, requester: Persona;

async function session(tenant: string, userId: string) {
  const sessionId = uuidv4();
  await db('sessions').insert({ tenant, session_id: sessionId, user_id: userId, created_at: db.fn.now(), expires_at: db.raw("now() + interval '1 day'") });
  return sessionId;
}
async function seedWorld() {
  const tenant = await createTenant(db, 'L4b Owner', { productCode: 'psa' });
  tenants.push(tenant);
  const clientId = uuidv4(), boardId = uuidv4(), statusId = uuidv4(), priorityId = uuidv4(), ticketId = uuidv4(), contactId = uuidv4();
  const techId = await createUser(db, tenant, { first_name: 'Morgan', last_name: 'Tech' });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'L4b Client', billing_cycle: 'monthly', is_tax_exempt: false });
  await db('contacts').insert({ tenant, contact_name_id: contactId, full_name: 'Rita Requester', email: `rita-${contactId}@example.com`, client_id: clientId });
  const portalUserId = await createUser(db, tenant, { user_type: 'client', contact_id: contactId, first_name: 'Rita', last_name: 'Requester' });
  await db('boards').insert({ tenant, board_id: boardId, board_name: 'Support', is_default: true, is_inactive: false });
  await db('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'High', item_type: 'ticket', color: '#EF4444', order_number: 10, created_by: techId });
  await db('statuses').insert({ tenant, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, order_number: 10, created_by: techId });
  await db('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: `L4B-${Date.now()}`, title: 'L4b ticket', client_id: clientId, contact_name_id: contactId,
    board_id: boardId, status_id: statusId, priority_id: priorityId, entered_by: techId });
  // The requester's portal role: client-side ticket:read, the same grant the portal engine retains.
  const permissionId = uuidv4(), roleId = uuidv4();
  await db('permissions').insert({ tenant, permission_id: permissionId, resource: 'ticket', action: 'read', msp: false, client: true });
  await db('roles').insert({ tenant, role_id: roleId, role_name: `Portal ${MARK}`, msp: false, client: true });
  await db('role_permissions').insert({ tenant, role_id: roleId, permission_id: permissionId });
  await db('user_roles').insert({ tenant, user_id: portalUserId, role_id: roleId });
  return { tenant, clientId, contactId, portalUserId, techId, ticketId };
}

const sharedWith = async (trx: any, actor: any, resource: any, request: any) => (await import('../../lib/co-managed/createTicketComment')).createSharedTicketComment(trx, actor, resource, request);
const shared = (p: Persona, request: any) => sharedWith(db, p.actor, p.resource, request);
const drafts = () => import('../../../../packages/co-managed/src/conversationDrafts');
const attachments = () => import('../../../../packages/co-managed/src/conversationAttachments');
const portal = () => import('../../lib/co-managed/portalAttachments');
const manifestOf = (files: TestFile[]) => files.map(f => ({ attachmentId: f.id, fileName: f.name, mimeType: f.mimeType, size: f.bytes.length, contentHash: f.hash }));
const draftRef = (p: Persona, operationId: string, audience: string, parent?: any) => ({ storeTenant: audience === 'organization_private' && p.actor.tenant !== p.resource.tenant ? p.actor.tenant : (parent?.storeTenant ?? p.resource.tenant), operationId });

/** begin -> upload every file -> publish, through the production draft state machine. */
async function post(p: Persona, input: { audience?: string; parent?: any; text: string; files: TestFile[]; operationId?: string; skipPublish?: boolean }) {
  const { beginCoManagedConversationDraft, uploadCoManagedDraftAttachment, publishCoManagedConversationDraft } = await drafts();
  const operationId = input.operationId ?? uuidv4();
  const request: any = { operationId, content: { text: input.text }, files: manifestOf(input.files), ...(input.parent ? { parent: input.parent } : { audience: input.audience }) };
  const begun = await beginCoManagedConversationDraft(db, p.actor, p.resource, request);
  const reference = { storeTenant: begun.storeTenant, operationId };
  for (const f of input.files) await uploadCoManagedDraftAttachment(db, p.actor, p.resource, reference, f.id, f.bytes, putObject);
  if (input.skipPublish) return { operationId, reference, request };
  const receipt: any = await publishCoManagedConversationDraft(db, p.actor, p.resource, reference, sharedWith as any);
  return { operationId, reference, request, receipt };
}
const refOf = (receipt: any, attachmentId: string) => ({ attachmentId, storeTenant: receipt.storeTenant, threadId: receipt.threadId, commentId: receipt.commentId });

/** Staff / customer-IT transport. */
async function readAs(p: Persona, receipt: any, attachmentId: string) {
  return (await attachments()).downloadCoManagedConversationAttachment(db, p.actor, p.resource, refOf(receipt, attachmentId), getObject);
}
/** Requester (portal) transport. */
async function portalRead(receipt: any, attachmentId: string) {
  return (await portal()).downloadPortalConversationAttachment(db, requester.actor, { ticketId: msp.ticketId, threadId: receipt.threadId, commentId: receipt.commentId }, attachmentId, getObject);
}
const denied = async (work: Promise<unknown>) => {
  const { CoManagedSharedWorkError } = await import('../../../../packages/co-managed/src/sharedWorkIdentity');
  await expect(work).rejects.toBeInstanceOf(CoManagedSharedWorkError);
};

beforeAll(async () => {
  db = await createTestDbConnection();
  testDb = db;
  (globalThis as any).__algaWriteAdmissionState = undefined;
  msp = await seedWorld();
  customer = await createTenant(db, 'L4b Workspace', { productCode: 'co_managed' });
  other = await createTenant(db, 'L4b Other Workspace', { productCode: 'co_managed' });
  tenants.push(customer, other);
  aliceId = await createUser(db, customer, { first_name: 'Alice', last_name: 'CustomerIT' });
  bobId = await createUser(db, other, { first_name: 'Bob', last_name: 'OtherOrg' });
  relationshipId = uuidv4();
  await db('co_management_relationships').insert({ tenant: msp.tenant, relationship_id: relationshipId, sponsor_tenant: customer, sponsor_client_id: msp.clientId });
  const resource = { kind: 'ticket', tenant: msp.tenant, relationshipId, id: msp.ticketId };
  tech = { actor: { kind: 'session', tenant: msp.tenant, userId: msp.techId, sessionId: await session(msp.tenant, msp.techId) }, resource };
  alice = { actor: { kind: 'session', tenant: customer, userId: aliceId, sessionId: await session(customer, aliceId) }, resource };
  bob = { actor: { kind: 'session', tenant: other, userId: bobId, sessionId: await session(other, bobId) }, resource };
  requester = { actor: { kind: 'session', tenant: msp.tenant, userId: msp.portalUserId, sessionId: await session(msp.tenant, msp.portalUserId) }, resource };
}, 180_000);

afterAll(async () => {
  if (db) {
    try {
      const { rows } = await db.raw(`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public' AND c.column_name = 'tenant'`);
      let pending: string[] = rows.map((r: any) => r.table_name);
      for (let pass = 0; pass < 12 && pending.length; pass++) {
        const blocked: string[] = [];
        for (const table of pending) { try { await db.raw('DELETE FROM ?? WHERE tenant = ANY(?::uuid[])', [table, tenants]); } catch { blocked.push(table); } }
        if (blocked.length === pending.length) break;
        pending = blocked;
      }
      if (pending.length) process.stderr.write(`L4b cleanup left tables: ${pending.join(', ')}\n`);
    } catch (error) { process.stderr.write(`L4b cleanup skipped: ${error instanceof Error ? error.message : String(error)}\n`); }
    await db.destroy();
  }
});
afterEach(() => { vi.clearAllMocks(); });

describe('A1/A2 audience x reader, both transports, real rows', () => {
  const posted: Record<string, { receipt: any; file: TestFile }> = {};
  beforeAll(async () => {
    for (const [key, author, audience] of [['requester', tech, 'requester'], ['sharedIt', alice, 'shared_it'], ['private', alice, 'organization_private']] as const) {
      const f = file(`${key}-${MARK}.pdf`);
      posted[key] = { receipt: (await post(author, { audience, text: `${key} body ${MARK}`, files: [f] })).receipt, file: f };
    }
  }, 120_000);

  it('stores the file in the owning store with the conversation audience and creates no documents row', async () => {
    expect(await db('co_management_conversation_attachments').where({ tenant: msp.tenant, comment_id: posted.requester.receipt.commentId, status: 'ready' })).toHaveLength(1);
    expect(await db('co_management_conversation_attachments').where({ tenant: msp.tenant, comment_id: posted.sharedIt.receipt.commentId, status: 'ready' })).toHaveLength(1);
    // organization_private bytes live only in the author's own tenant store
    expect(await db('co_management_conversation_attachments').where({ tenant: msp.tenant, comment_id: posted.private.receipt.commentId })).toHaveLength(0);
    const privateRows = await db('co_management_conversation_attachments').where({ tenant: customer, comment_id: posted.private.receipt.commentId, status: 'ready' });
    expect(privateRows).toHaveLength(1);
    expect(privateRows[0].storage_path).toBe(`co-management/${customer}/${privateRows[0].attachment_id}`);
    for (const { file: f } of Object.values(posted)) {
      expect(await db('documents').whereIn('tenant', tenants).where('document_name', f.name)).toHaveLength(0);
      expect(await db('external_files').whereIn('tenant', tenants).where('file_name', f.name)).toHaveLength(0);
    }
    expect(await db('ticket_comment_attachments').where({ tenant: msp.tenant, ticket_id: msp.ticketId })).toHaveLength(0);
  });

  const cases: Array<[string, 'requester' | 'sharedIt' | 'private', Record<string, boolean>]> = [
    // reader: tech (owner staff), alice (workspace IT), bob (other org IT), rita (portal requester)
    ['requester comment', 'requester', { tech: true, alice: true, bob: true, rita: true }],
    ['shared_it comment', 'sharedIt', { tech: true, alice: true, bob: true, rita: false }],
    ['organization_private comment (Alice)', 'private', { tech: false, alice: true, bob: false, rita: false }],
  ];
  for (const [name, key, expected] of cases) {
    it(`${name}: reads match the audience predicate on both transports`, async () => {
      const { receipt, file: f } = posted[key];
      const attachmentId = f.id;
      const results: Record<string, boolean> = {};
      for (const [who, persona] of [['tech', tech], ['alice', alice], ['bob', bob]] as const) {
        try {
          const out = await readAs(persona, receipt, attachmentId);
          expect(sha(out.content)).toBe(f.hash);
          expect(out.attachment).toMatchObject({ attachmentId, fileName: f.name, size: f.bytes.length });
          results[who] = true;
        } catch (error) {
          const { CoManagedSharedWorkError } = await import('../../../../packages/co-managed/src/sharedWorkIdentity');
          expect(error, `${who}`).toBeInstanceOf(CoManagedSharedWorkError);
          results[who] = false;
        }
      }
      try { expect(sha((await portalRead(receipt, attachmentId)).content)).toBe(f.hash); results.rita = true; }
      catch (error) {
        const { CoManagedSharedWorkError } = await import('../../../../packages/co-managed/src/sharedWorkIdentity');
        expect(error, 'rita').toBeInstanceOf(CoManagedSharedWorkError);
        results.rita = false;
      }
      expect(results).toEqual(expected);
    });
  }

  it('listing follows the same audience decision (staff list, portal list)', async () => {
    const { listCoManagedConversationAttachments } = await attachments();
    const list = (p: Persona, key: keyof typeof posted) => listCoManagedConversationAttachments(db, p.actor, p.resource,
      { storeTenant: posted[key].receipt.storeTenant, threadId: posted[key].receipt.threadId, commentId: posted[key].receipt.commentId });
    expect((await list(tech, 'requester')).map(a => a.attachmentId)).toEqual([posted.requester.file.id]);
    expect((await list(alice, 'sharedIt')).map(a => a.attachmentId)).toEqual([posted.sharedIt.file.id]);
    expect((await list(alice, 'private')).map(a => a.attachmentId)).toEqual([posted.private.file.id]);
    await denied(list(tech, 'private'));
    await denied(list(bob, 'private'));
    const { listPortalConversationAttachments } = await portal();
    const target = (key: keyof typeof posted) => ({ ticketId: msp.ticketId, threadId: posted[key].receipt.threadId, commentId: posted[key].receipt.commentId });
    expect((await listPortalConversationAttachments(db, requester.actor, target('requester'))).map(a => a.attachmentId)).toEqual([posted.requester.file.id]);
    await denied(listPortalConversationAttachments(db, requester.actor, target('sharedIt')));
    await denied(listPortalConversationAttachments(db, requester.actor, target('private')));
  });

  it('a requester-shaped id cannot be spoofed across comments or stores', async () => {
    // A real attachment id presented under a different comment, or with a different store, resolves to nothing.
    await denied(readAs(tech, posted.sharedIt.receipt, posted.requester.file.id));
    await denied(readAs(alice, { ...posted.private.receipt, storeTenant: msp.tenant }, posted.private.file.id));
    await denied(readAs(alice, { ...posted.sharedIt.receipt, storeTenant: customer }, posted.sharedIt.file.id));
    await denied(portalRead(posted.requester.receipt, posted.sharedIt.file.id));
  });

  it('the generic document lookups do not find a conversation attachment id', async () => {
    const { getAuthorizedDocumentById, getAuthorizedDocumentByFileId } = await import('@alga-psa/documents/actions/documentActions');
    currentUser = { user_id: msp.techId, user_type: 'internal', tenant: msp.tenant };
    for (const key of ['requester', 'sharedIt'] as const) {
      const id = posted[key].file.id;
      const byId: any = await getAuthorizedDocumentById(id).catch(() => null);
      const byFile: any = await getAuthorizedDocumentByFileId(id).catch(() => null);
      expect(byId == null || byId.success === false || byId.document == null, `byId ${key}`).toBe(true);
      expect(byFile == null || byFile.success === false || byFile.document == null, `byFile ${key}`).toBe(true);
    }
  });
});

describe('A3 drafts: begin -> reload -> publish, discard, sweeper', () => {
  it('reload restores text, audience and pending files; publish happens exactly once and replays the same receipt; files unreadable until published', async () => {
    const { beginCoManagedConversationDraft, uploadCoManagedDraftAttachment, publishCoManagedConversationDraft, CoManagedConversationDraftError } = await drafts();
    const first = file(`draft-a-${MARK}.pdf`), second = file(`draft-b-${MARK}.png`, 32, 'image/png');
    const operationId = uuidv4();
    const request: any = { operationId, audience: 'shared_it', content: { text: `draft text ${MARK}` }, files: manifestOf([first, second]) };
    const begun = await beginCoManagedConversationDraft(db, alice.actor, alice.resource, request);
    expect(begun).toMatchObject({ status: 'draft', storeTenant: msp.tenant, uploadedAttachmentIds: [] });
    const reference = { storeTenant: begun.storeTenant, operationId };
    await uploadCoManagedDraftAttachment(db, alice.actor, alice.resource, reference, first.id, first.bytes, putObject);
    // "reload": the same request again restores the server-side draft with its pending files
    const reloaded = await beginCoManagedConversationDraft(db, alice.actor, alice.resource, request);
    expect(reloaded.uploadedAttachmentIds).toEqual([first.id]);
    const row = await db('co_management_conversation_drafts').where({ tenant: msp.tenant, operation_id: operationId }).first();
    expect(row).toMatchObject({ audience: 'shared_it', status: 'draft', actor_tenant: customer, actor_user_id: aliceId });
    expect(row.request.content.text).toBe(`draft text ${MARK}`);
    expect(row.manifest.map((m: any) => m.attachmentId).sort()).toEqual([first.id, second.id].sort());
    // not ready, not publishable, nothing readable
    await expect(publishCoManagedConversationDraft(db, alice.actor, alice.resource, reference, sharedWith as any))
      .rejects.toMatchObject({ code: 'CONVERSATION_DRAFT_NOT_READY' });
    expect(await db('comments').where({ tenant: msp.tenant, comment_id: operationId })).toHaveLength(0);
    await denied(readAs(alice, { storeTenant: msp.tenant, threadId: operationId, commentId: operationId }, first.id));
    // another operation's draft cannot be completed by a different actor
    await expect(uploadCoManagedDraftAttachment(db, bob.actor, bob.resource, reference, second.id, second.bytes, putObject)).rejects.toBeTruthy();

    await uploadCoManagedDraftAttachment(db, alice.actor, alice.resource, reference, second.id, second.bytes, putObject);
    const [one, two] = await Promise.all([
      publishCoManagedConversationDraft(db, alice.actor, alice.resource, reference, sharedWith as any),
      publishCoManagedConversationDraft(db, alice.actor, alice.resource, reference, sharedWith as any),
    ]);
    expect(one).toEqual(two);
    const replay = await publishCoManagedConversationDraft(db, alice.actor, alice.resource, reference, sharedWith as any);
    expect(replay).toEqual(one);
    expect(await db('comments').where({ tenant: msp.tenant, comment_id: operationId })).toHaveLength(1);
    expect(await db('co_management_command_receipts').where({ tenant: msp.tenant, operation_id: operationId })).toHaveLength(1);
    expect(await db('co_management_conversation_drafts').where({ tenant: msp.tenant, operation_id: operationId }).first()).toMatchObject({ status: 'published' });
    // published: now both files read, for the author and for the owner's staff
    expect(sha((await readAs(tech, one, first.id)).content)).toBe(first.hash);
    expect(sha((await readAs(alice, one, second.id)).content)).toBe(second.hash);
    await denied(portalRead(one, first.id));
    // a published draft cannot be re-opened with different content
    await expect(beginCoManagedConversationDraft(db, alice.actor, alice.resource, { ...request, content: { text: 'changed' } })).rejects.toBeInstanceOf(CoManagedConversationDraftError);
  });

  it('discarding releases the files and the draft can never publish; a late upload is refused', async () => {
    const { abandonCoManagedConversationDraft, publishCoManagedConversationDraft, uploadCoManagedDraftAttachment, beginCoManagedConversationDraft } = await drafts();
    const a = file(`discard-a-${MARK}.pdf`), b = file(`discard-b-${MARK}.pdf`);
    const { reference, request } = await post(alice, { audience: 'requester', text: 'to discard', files: [a, b].slice(0, 1), skipPublish: true }) as any;
    expect((await abandonCoManagedConversationDraft(db, alice.actor, alice.resource, reference))).toEqual({ status: 'abandoned' });
    const rows = await db('co_management_conversation_attachments').where({ tenant: msp.tenant, draft_operation_id: reference.operationId });
    expect(rows).toHaveLength(1);
    expect(rows[0].discarded_at).not.toBeNull();
    // idempotent
    expect(await abandonCoManagedConversationDraft(db, alice.actor, alice.resource, reference)).toEqual({ status: 'abandoned' });
    await expect(publishCoManagedConversationDraft(db, alice.actor, alice.resource, reference, sharedWith as any)).rejects.toMatchObject({ code: 'CONVERSATION_DRAFT_ABANDONED' });
    await expect(uploadCoManagedDraftAttachment(db, alice.actor, alice.resource, reference, a.id, a.bytes, putObject)).rejects.toMatchObject({ code: 'CONVERSATION_DRAFT_ABANDONED' });
    await expect(beginCoManagedConversationDraft(db, alice.actor, alice.resource, request)).rejects.toMatchObject({ code: 'CONVERSATION_DRAFT_ABANDONED' });
    // only the author may discard
    const mine = await post(alice, { audience: 'requester', text: 'not yours', files: [file(`other-${MARK}.pdf`)], skipPublish: true });
    await denied(abandonCoManagedConversationDraft(db, bob.actor, bob.resource, mine.reference));
  });

  it('the sweeper removes expired drafts\' bytes exactly once and is idempotent', async () => {
    const { cleanupCoManagedUploads } = await import('../../../../packages/co-managed/src/uploadCleanup');
    await cleanupCoManagedUploads(db, msp.tenant, async () => {}); // flush earlier tests' expired work so the counts below are exact
    const f = file(`sweep-${MARK}.pdf`);
    const { reference } = await post(alice, { audience: 'shared_it', text: 'abandoned draft', files: [f], skipPublish: true });
    const path = (await db('co_management_conversation_attachments').where({ tenant: msp.tenant, attachment_id: f.id }).first()).storage_path;
    expect(objects.has(path)).toBe(true);
    await db('co_management_conversation_drafts').where({ tenant: msp.tenant, operation_id: reference.operationId }).update({ last_activity_at: db.raw("now() - interval '8 days'") });
    const removed: string[] = [];
    const remove = async (p: string) => { removed.push(p); objects.delete(p); };
    const first = await cleanupCoManagedUploads(db, msp.tenant, remove);
    expect(first).toMatchObject({ abandonedDrafts: 1, purgedFiles: 1, completedDrafts: 1, failedFiles: 0 });
    expect(removed).toEqual([path]);
    expect(objects.has(path)).toBe(false);
    const draft = await db('co_management_conversation_drafts').where({ tenant: msp.tenant, operation_id: reference.operationId }).first();
    expect(draft.cleanup_completed_at).not.toBeNull();
    expect(draft.request).toEqual({ operationId: reference.operationId }); // content no longer retained
    expect(await db('co_management_conversation_attachments').where({ tenant: msp.tenant, attachment_id: f.id }).first()).toMatchObject({ file_name: 'Removed attachment' });
    const second = await cleanupCoManagedUploads(db, msp.tenant, remove);
    expect(second).toMatchObject({ abandonedDrafts: 0, purgedFiles: 0, completedDrafts: 0, failedFiles: 0 });
    expect(removed).toHaveLength(1);
  });

  it('a provider failure is retried with backoff and removes the bytes once; a removed published file is purged too', async () => {
    const { cleanupCoManagedUploads } = await import('../../../../packages/co-managed/src/uploadCleanup');
    const { removeCoManagedConversationAttachment } = await attachments();
    await cleanupCoManagedUploads(db, msp.tenant, async () => {}); // flush other tests' purgeable work (test order is shuffled)
    const f = file(`remove-${MARK}.pdf`);
    const { receipt } = await post(alice, { audience: 'shared_it', text: 'will remove a file', files: [f] });
    const path = (await db('co_management_conversation_attachments').where({ tenant: msp.tenant, attachment_id: f.id }).first()).storage_path;
    await removeCoManagedConversationAttachment(db, alice.actor, alice.resource, refOf(receipt, f.id));
    await denied(readAs(tech, receipt, f.id));
    const failing = await cleanupCoManagedUploads(db, msp.tenant, async () => { throw new Error('provider down'); });
    expect(failing).toMatchObject({ purgedFiles: 0, failedFiles: 1 });
    expect(await db('co_management_conversation_attachments').where({ tenant: msp.tenant, attachment_id: f.id }).first())
      .toMatchObject({ cleanup_attempts: 1, cleanup_error_code: 'attachment_cleanup_failed', purged_at: null });
    expect(objects.has(path)).toBe(true);
    await db('co_management_conversation_attachments').where({ tenant: msp.tenant, attachment_id: f.id }).update({ cleanup_next_attempt_at: db.raw('now()') });
    const removed: string[] = [];
    expect(await cleanupCoManagedUploads(db, msp.tenant, async p => { removed.push(p); objects.delete(p); })).toMatchObject({ purgedFiles: 1, failedFiles: 0 });
    expect(removed).toEqual([path]);
    expect(await cleanupCoManagedUploads(db, msp.tenant, async p => { removed.push(p); })).toMatchObject({ purgedFiles: 0 });
    expect(removed).toHaveLength(1);
  });
});

describe('A4 thread disclosure', () => {
  const sourceFiles = (n: number) => Array.from({ length: n }, (_, i) => file(`disclose-${i}-${MARK}.bin`, 48 + i, 'application/octet-stream'));

  it('same-tenant relabel: preview snapshot, a concurrent edit forces review and writes nothing, confirm relabels once and the files follow', async () => {
    const { previewCoManagedThreadDisclosure, discloseCoManagedThread, CoManagedThreadDisclosureError } = await import('../../../../packages/co-managed/src/threadDisclosure');
    const f = file(`relabel-${MARK}.pdf`);
    const { receipt } = await post(alice, { audience: 'shared_it', text: `relabel root ${MARK}`, files: [f] });
    const thread = { storeTenant: msp.tenant, threadId: receipt.threadId };
    const preview = await previewCoManagedThreadDisclosure(db, alice.actor, alice.resource, thread);
    expect(preview).toMatchObject({ audience: 'shared_it', comments: 1, attachments: 1, pendingAttachments: 0 });
    expect(preview.snapshot).toMatch(/^[0-9a-f]{64}$/);
    await denied(readAs(tech, receipt, f.id).then(() => portalRead(receipt, f.id)));

    // a reply lands after the preview: confirming the old snapshot must disclose a conflict and change nothing
    await shared(alice, { operationId: uuidv4(), parent: { storeTenant: msp.tenant, threadId: receipt.threadId, commentId: receipt.commentId }, text: `late reply ${MARK}` });
    const operationId = uuidv4();
    const request = { ...thread, operationId, expectedSnapshot: preview.snapshot, audience: 'requester' as const, confirmed: true as const };
    const after = vi.fn(async () => {});
    await expect(discloseCoManagedThread(db, alice.actor, alice.resource, request, after)).rejects.toMatchObject({ code: 'THREAD_DISCLOSURE_CONFLICT' });
    expect(after).not.toHaveBeenCalled();
    expect(await db('co_management_command_receipts').where({ tenant: msp.tenant, operation_id: operationId })).toHaveLength(0);
    expect(await db('comment_threads').where({ tenant: msp.tenant, thread_id: receipt.threadId }).first()).toMatchObject({ collaboration_audience: 'shared_it', is_internal: true });

    const fresh = await previewCoManagedThreadDisclosure(db, alice.actor, alice.resource, thread);
    expect(fresh.comments).toBe(2);
    expect(fresh.snapshot).not.toBe(preview.snapshot);
    const confirmed = { ...request, expectedSnapshot: fresh.snapshot };
    const applied = await discloseCoManagedThread(db, alice.actor, alice.resource, confirmed, after);
    expect(applied).toMatchObject({ audience: 'requester', threadId: receipt.threadId, operationId });
    expect(after).toHaveBeenCalledTimes(1);
    expect(await db('comment_threads').where({ tenant: msp.tenant, thread_id: receipt.threadId }).first()).toMatchObject({ collaboration_audience: 'requester', is_internal: false });
    expect(await db('comments').where({ tenant: msp.tenant, thread_id: receipt.threadId, is_internal: true })).toHaveLength(0);
    // exactly one operation record; a same-tenant relabel moves no bytes (no transfer row, same file row and path)
    expect(await db('co_management_command_receipts').where({ tenant: msp.tenant, operation_id: operationId, command_type: 'ticket_thread_audience' })).toHaveLength(1);
    expect(await db('co_management_thread_transfers').where({ operation_id: operationId })).toHaveLength(0);
    const row = await db('co_management_conversation_attachments').where({ tenant: msp.tenant, attachment_id: f.id }).first();
    expect(row).toMatchObject({ status: 'ready', thread_id: receipt.threadId });
    expect(row.storage_path).toBe(`co-management/${msp.tenant}/${f.id}`);
    // replay returns the same receipt without a second write
    expect(await discloseCoManagedThread(db, alice.actor, alice.resource, confirmed, after)).toEqual(applied);
    expect(await db('co_management_command_receipts').where({ tenant: msp.tenant, operation_id: operationId })).toHaveLength(1);
    expect(after).toHaveBeenCalledTimes(1);
    // the same operation id for a different request is refused
    await expect(discloseCoManagedThread(db, alice.actor, alice.resource, { ...confirmed, audience: 'shared_it' }, after)).rejects.toBeInstanceOf(CoManagedThreadDisclosureError);
    // and the requester can now read what the thread now discloses
    expect(sha((await portalRead(receipt, f.id)).content)).toBe(f.hash);
    expect(sha((await readAs(tech, receipt, f.id)).content)).toBe(f.hash);
  });

  it('refuses a same-tenant relabel over a reply that is not consistent with its thread (private-replies guard)', async () => {
    const { previewCoManagedThreadDisclosure } = await import('../../../../packages/co-managed/src/threadDisclosure');
    const { receipt } = await post(alice, { audience: 'shared_it', text: `strict ${MARK}`, files: [file(`strict-${MARK}.pdf`)] });
    const reply = await shared(alice, { operationId: uuidv4(), parent: { storeTenant: msp.tenant, threadId: receipt.threadId, commentId: receipt.commentId }, text: `reply ${MARK}` });
    const thread = { storeTenant: msp.tenant, threadId: receipt.threadId };
    // Valid data cannot hold a reply stricter than its thread (CHECK constraints + the writer), so the guard is exercised with the
    // only damage the schema allows: a reply whose internal flag disagrees with the thread audience. It must be refused, never relabelled.
    await db('comments').where({ tenant: msp.tenant, comment_id: reply.commentId }).update({ is_internal: false });
    await expect(previewCoManagedThreadDisclosure(db, alice.actor, alice.resource, thread)).rejects.toMatchObject({ code: expect.stringMatching(/^THREAD_DISCLOSURE_(CONFLICT|PRIVATE_REPLIES)$/) });
    expect(await db('comment_threads').where({ tenant: msp.tenant, thread_id: receipt.threadId }).first()).toMatchObject({ collaboration_audience: 'shared_it' });
  });

  describe('private -> shared (byte copy across stores)', () => {
    const transport = { download: getObject, upload: putObject as (p: string, c: Uint8Array, m: string) => Promise<void> };
    const privateThread = async (files: TestFile[], reply?: boolean) => {
      const { receipt } = await post(alice, { audience: 'organization_private', text: `private ${MARK}`, files });
      if (reply) await post(alice, { parent: { storeTenant: customer, threadId: receipt.threadId, commentId: receipt.commentId }, text: `private reply ${MARK}`, files: [file(`reply-${MARK}.txt`, 8, 'text/plain')] });
      return receipt;
    };

    it('copies bytes with matching content hashes, maps every comment and records one transfer row', async () => {
      const { previewCoManagedPrivateThreadDisclosure, discloseCoManagedPrivateThread } = await import('../../../../packages/co-managed/src/privateThreadDisclosure');
      const files = sourceFiles(2);
      const receipt = await privateThread(files, true);
      const thread = { storeTenant: customer, threadId: receipt.threadId };
      const preview = await previewCoManagedPrivateThreadDisclosure(db, alice.actor, alice.resource, thread);
      expect(preview).toMatchObject({ audience: 'organization_private', comments: 2, attachments: 3, pendingAttachments: 0 });
      const operationId = uuidv4();
      const after = vi.fn(async () => {});
      const disclosed = await discloseCoManagedPrivateThread(db, alice.actor, alice.resource,
        { ...thread, operationId, expectedSnapshot: preview.snapshot, audience: 'shared_it', confirmed: true }, transport, after);
      expect(disclosed).toMatchObject({ storeTenant: msp.tenant, threadId: operationId, audience: 'shared_it', sourceStoreTenant: customer, sourceThreadId: receipt.threadId });
      expect(after).toHaveBeenCalledTimes(1);

      const transfers = await db('co_management_thread_transfers').where({ tenant: customer, operation_id: operationId });
      expect(transfers).toHaveLength(1);
      expect(transfers[0]).toMatchObject({ status: 'published', audience: 'shared_it', source_thread_id: receipt.threadId });
      const sourceComments = await db('co_management_private_comments').where({ tenant: customer, thread_id: receipt.threadId });
      const commentMap = transfers[0].comment_map as Record<string, string>;
      expect(Object.keys(commentMap).sort()).toEqual(sourceComments.map(c => c.comment_id).sort());
      const copiedComments = await db('comments').where({ tenant: msp.tenant, thread_id: operationId });
      expect(copiedComments.map(c => c.comment_id).sort()).toEqual(Object.values(commentMap).sort());
      expect(copiedComments.every(c => c.is_internal === true && c.publish_state === 'published')).toBe(true);
      expect(await db('comment_threads').where({ tenant: msp.tenant, thread_id: operationId }).first()).toMatchObject({ collaboration_audience: 'shared_it', root_comment_id: operationId });
      expect(await db('co_management_private_threads').where({ tenant: customer, thread_id: receipt.threadId }).first()).toMatchObject({ disclosure_operation_id: operationId });

      const originals = await db('co_management_conversation_attachments').where({ tenant: customer, thread_id: receipt.threadId, status: 'ready' });
      const copies = await db('co_management_conversation_attachments').where({ tenant: msp.tenant, thread_id: operationId, status: 'ready' });
      expect(copies).toHaveLength(originals.length);
      for (const original of originals) {
        const copy = copies.find(c => c.content_hash === original.content_hash && c.file_name === original.file_name)!;
        expect(copy, original.file_name).toBeTruthy();
        expect(copy.comment_id).toBe(commentMap[original.comment_id]);
        expect(copy).toMatchObject({ disclosure_operation_id: operationId, disclosure_sponsor_tenant: customer, file_size: original.file_size });
        expect(copy.storage_path).toBe(`co-management/${msp.tenant}/disclosures/${customer}/${operationId}/${copy.attachment_id}`);
        expect(sha(await getObject(copy.storage_path))).toBe(original.content_hash);
        expect(sha(await getObject(original.storage_path))).toBe(original.content_hash); // the source copy is untouched
      }
      // the disclosed copy is now an ordinary shared_it file: staff read it, the requester still cannot, the source thread is gone from authoring
      const copyOfFirst = copies.find(c => c.content_hash === files[0].hash)!;
      const publishedReceipt = { storeTenant: msp.tenant, threadId: operationId, commentId: copyOfFirst.comment_id };
      expect(sha((await readAs(tech, publishedReceipt, copyOfFirst.attachment_id)).content)).toBe(files[0].hash);
      await denied(portalRead(publishedReceipt, copyOfFirst.attachment_id));
      // the conversation reader no longer lists the disclosed SOURCE thread (no duplicate, no unreadable attachments, no disclose control):
      // only the shared copy remains, and a not-yet-disclosed private thread still shows.
      const { getCoManagedTicketConversation } = await import('../../../../packages/co-managed/src/ticketConversation');
      const listed = await getCoManagedTicketConversation(db, alice.actor, alice.resource);
      expect(listed.items.some(item => item.threadId === receipt.threadId)).toBe(false);
      expect(listed.items.filter(item => item.threadId === operationId).map(item => item.audience)).toEqual(copiedComments.map(() => 'shared_it'));
      const stillPrivate = await privateThread(sourceFiles(1));
      expect((await getCoManagedTicketConversation(db, alice.actor, alice.resource)).items.some(item => item.threadId === stillPrivate.threadId && item.audience === 'organization_private')).toBe(true);
      // replay is the same receipt, no second transfer
      expect(await discloseCoManagedPrivateThread(db, alice.actor, alice.resource,
        { ...thread, operationId, expectedSnapshot: preview.snapshot, audience: 'shared_it', confirmed: true }, transport, after)).toEqual(disclosed);
      expect(await db('co_management_thread_transfers').where({ tenant: customer, operation_id: operationId })).toHaveLength(1);
      expect(await db('comments').where({ tenant: msp.tenant, thread_id: operationId })).toHaveLength(copiedComments.length);
    });

    it('a concurrent edit after the preview discloses a conflict and nothing is written', async () => {
      const { previewCoManagedPrivateThreadDisclosure, discloseCoManagedPrivateThread } = await import('../../../../packages/co-managed/src/privateThreadDisclosure');
      const receipt = await privateThread(sourceFiles(1));
      const thread = { storeTenant: customer, threadId: receipt.threadId };
      const preview = await previewCoManagedPrivateThreadDisclosure(db, alice.actor, alice.resource, thread);
      await post(alice, { parent: { storeTenant: customer, threadId: receipt.threadId, commentId: receipt.commentId }, text: `edited after preview ${MARK}`, files: [file(`late-${MARK}.txt`, 4, 'text/plain')] });
      const operationId = uuidv4(), before = objects.size;
      await expect(discloseCoManagedPrivateThread(db, alice.actor, alice.resource,
        { ...thread, operationId, expectedSnapshot: preview.snapshot, audience: 'shared_it', confirmed: true }, transport, async () => {})).rejects.toMatchObject({ code: 'THREAD_DISCLOSURE_CONFLICT' });
      expect(await db('co_management_thread_transfers').where({ tenant: customer, operation_id: operationId })).toHaveLength(0);
      expect(await db('comment_threads').where({ tenant: msp.tenant, thread_id: operationId })).toHaveLength(0);
      expect(await db('comments').where({ tenant: msp.tenant, thread_id: operationId })).toHaveLength(0);
      expect(objects.size).toBe(before);
    });

    it('a mid-copy failure abandons nothing visible, retries resume, and an unfinished transfer is swept and retryable', async () => {
      const { previewCoManagedPrivateThreadDisclosure, discloseCoManagedPrivateThread } = await import('../../../../packages/co-managed/src/privateThreadDisclosure');
      const { cleanupCoManagedThreadTransfers } = await import('../../../../packages/co-managed/src/privateThreadTransferCleanup');
      const receipt = await privateThread(sourceFiles(3));
      const thread = { storeTenant: customer, threadId: receipt.threadId };
      const preview = await previewCoManagedPrivateThreadDisclosure(db, alice.actor, alice.resource, thread);
      const operationId = uuidv4();
      const request = { ...thread, operationId, expectedSnapshot: preview.snapshot, audience: 'shared_it' as const, confirmed: true as const };
      let uploads = 0;
      const flaky = { download: getObject, upload: async (p: string, c: Uint8Array, m: string) => { if (++uploads === 2) throw new Error('injected mid-copy failure'); return putObject(p, c); } };
      await expect(discloseCoManagedPrivateThread(db, alice.actor, alice.resource, request, flaky, async () => {})).rejects.toThrow('injected mid-copy failure');
      // the transfer is prepared (one file copied); the shared thread does not exist and nothing is readable
      const transfer = await db('co_management_thread_transfers').where({ tenant: customer, operation_id: operationId }).first();
      expect(transfer.status).toBe('prepared');
      expect((transfer.manifest as any[]).filter(m => m.copied)).toHaveLength(1);
      expect(await db('comment_threads').where({ tenant: msp.tenant, thread_id: operationId })).toHaveLength(0);
      expect(await db('comments').where({ tenant: msp.tenant, thread_id: operationId })).toHaveLength(0);
      expect(await db('co_management_conversation_attachments').where({ tenant: msp.tenant, thread_id: operationId })).toHaveLength(0);
      expect(await db('co_management_private_threads').where({ tenant: customer, thread_id: receipt.threadId }).first()).toMatchObject({ disclosure_operation_id: null });
      const reserved: string[] = (transfer.manifest as any[]).map(m => m.path);
      expect(reserved.filter(p => objects.has(p))).toHaveLength(1);

      // sweep before the retention window: nothing happens
      const quiet = await cleanupCoManagedThreadTransfers(db, customer, async () => { throw new Error('must not run'); });
      expect(quiet).toMatchObject({ abandonedTransfers: 0, cleanedTransfers: 0 });
      // the retention window passes; the first sweep's provider call fails and is scheduled for retry, not lost
      await db('co_management_thread_transfers').where({ tenant: customer, operation_id: operationId }).update({ last_activity_at: db.raw("now() - interval '8 days'") });
      const broken = await cleanupCoManagedThreadTransfers(db, customer, async () => { throw new Error('provider down'); });
      expect(broken).toMatchObject({ abandonedTransfers: 1, cleanedTransfers: 0, failedTransfers: 1 });
      expect(await db('co_management_thread_transfers').where({ tenant: customer, operation_id: operationId }).first())
        .toMatchObject({ status: 'abandoned', cleaned_at: null, cleanup_attempts: 1, cleanup_error_code: 'thread_transfer_cleanup_failed' });
      await db('co_management_thread_transfers').where({ tenant: customer, operation_id: operationId }).update({ cleanup_next_attempt_at: db.raw('now()') });
      const removed: string[] = [];
      const ok = await cleanupCoManagedThreadTransfers(db, customer, async p => { removed.push(p); objects.delete(p); });
      expect(ok).toMatchObject({ cleanedTransfers: 1, failedTransfers: 0 });
      expect(removed.sort()).toEqual([...reserved].sort());
      expect(reserved.filter(p => objects.has(p))).toHaveLength(0);
      expect(await db('co_management_thread_transfers').where({ tenant: customer, operation_id: operationId }).first()).toMatchObject({ cleaned_at: expect.anything(), manifest: [] });
      // idempotent
      expect(await cleanupCoManagedThreadTransfers(db, customer, async p => { removed.push(p); })).toMatchObject({ abandonedTransfers: 0, cleanedTransfers: 0 });
      expect(removed).toHaveLength(reserved.length);
      // an abandoned operation id can never be reused to publish
      await expect(discloseCoManagedPrivateThread(db, alice.actor, alice.resource, request, transport, async () => {})).rejects.toMatchObject({ code: 'THREAD_DISCLOSURE_CONFLICT' });
      // the source thread is still intact and can be disclosed again under a new operation
      const again = await discloseCoManagedPrivateThread(db, alice.actor, alice.resource, { ...request, operationId: uuidv4() }, transport, async () => {});
      expect(again).toMatchObject({ audience: 'shared_it', sourceThreadId: receipt.threadId });
    });

    it('a transient failure is resumed by retrying the same operation (single transfer, no duplicate comments)', async () => {
      const { previewCoManagedPrivateThreadDisclosure, discloseCoManagedPrivateThread } = await import('../../../../packages/co-managed/src/privateThreadDisclosure');
      const receipt = await privateThread(sourceFiles(2));
      const thread = { storeTenant: customer, threadId: receipt.threadId };
      const preview = await previewCoManagedPrivateThreadDisclosure(db, alice.actor, alice.resource, thread);
      const operationId = uuidv4(), request = { ...thread, operationId, expectedSnapshot: preview.snapshot, audience: 'requester' as const, confirmed: true as const };
      let failed = false;
      const flaky = { download: getObject, upload: async (p: string, c: Uint8Array, m: string) => { if (!failed) { failed = true; throw new Error('transient'); } return putObject(p, c); } };
      await expect(discloseCoManagedPrivateThread(db, alice.actor, alice.resource, request, flaky, async () => {})).rejects.toThrow('transient');
      const done = await discloseCoManagedPrivateThread(db, alice.actor, alice.resource, request, transport, async () => {});
      expect(done).toMatchObject({ audience: 'requester', threadId: operationId });
      expect(await db('co_management_thread_transfers').where({ tenant: customer, operation_id: operationId })).toHaveLength(1);
      expect(await db('comments').where({ tenant: msp.tenant, thread_id: operationId })).toHaveLength(2 - 1); // the root only: no replies were posted
      // requester audience: the requester reads the disclosed file over the portal transport
      const copy = await db('co_management_conversation_attachments').where({ tenant: msp.tenant, thread_id: operationId, status: 'ready' }).first();
      expect(sha((await portalRead({ threadId: operationId, commentId: copy.comment_id }, copy.attachment_id)).content)).toBe(copy.content_hash);
    });

    it('refuses a thread with more than 20 files, and refuses a customer-owned thread', async () => {
      const { previewCoManagedPrivateThreadDisclosure } = await import('../../../../packages/co-managed/src/privateThreadDisclosure');
      const { previewCoManagedThreadDisclosure } = await import('../../../../packages/co-managed/src/threadDisclosure');
      const receipt = await privateThread(sourceFiles(20));
      const thread = { storeTenant: customer, threadId: receipt.threadId };
      expect((await previewCoManagedPrivateThreadDisclosure(db, alice.actor, alice.resource, thread)).attachments).toBe(20);
      // the 21st file arrives on a reply; the whole disclosure is then refused by the cap
      await post(alice, { parent: { storeTenant: customer, threadId: receipt.threadId, commentId: receipt.commentId }, text: `21st ${MARK}`, files: [file(`twenty-first-${MARK}.txt`, 4, 'text/plain')] });
      await expect(previewCoManagedPrivateThreadDisclosure(db, alice.actor, alice.resource, thread)).rejects.toMatchObject({ code: 'THREAD_DISCLOSURE_TOO_MANY_FILES' });
      // the in-place relabel path never accepts a private thread
      await denied(previewCoManagedThreadDisclosure(db, alice.actor, alice.resource, thread));
      // another organization cannot preview Alice's private thread
      await denied(previewCoManagedPrivateThreadDisclosure(db, bob.actor, bob.resource, thread));
    }, 180_000);
  });
});

describe('A3 draft restore: the actor\'s open drafts are readable after a reload without knowing the operation id', () => {
  it('returns text, audience and pending/ready files for the author only; published and discarded drafts drop out', async () => {
    const { listCoManagedOpenConversationDrafts, abandonCoManagedConversationDraft } = await drafts();
    const first = file(`restore-a-${MARK}.pdf`), second = file(`restore-b-${MARK}.png`, 32, 'image/png');
    const operationId = uuidv4();
    const begun = await (await drafts()).beginCoManagedConversationDraft(db, alice.actor, alice.resource,
      { operationId, audience: 'shared_it', content: { text: `restore text ${MARK}` }, files: manifestOf([first, second]) } as any);
    await (await drafts()).uploadCoManagedDraftAttachment(db, alice.actor, alice.resource, { storeTenant: begun.storeTenant, operationId }, first.id, first.bytes, putObject);

    const mine = (await listCoManagedOpenConversationDrafts(db, alice.actor, alice.resource)).find(d => d.operationId === operationId)!;
    expect(mine).toMatchObject({ storeTenant: msp.tenant, status: 'draft', audience: 'shared_it', uploadedAttachmentIds: [first.id] });
    expect(mine.content).toMatchObject({ text: `restore text ${MARK}` });
    expect(mine.files.map(f => f.attachmentId).sort()).toEqual([first.id, second.id].sort());
    // scoped to the author: another actor of the same workspace sees nothing of it
    expect((await listCoManagedOpenConversationDrafts(db, bob.actor, bob.resource)).some(d => d.operationId === operationId)).toBe(false);
    // a private-audience draft lives in the author's own store and is restored from there
    const privateOp = uuidv4();
    const privateDraft = await post(alice, { audience: 'organization_private', text: `restore private ${MARK}`, files: [file(`restore-p-${MARK}.bin`)], operationId: privateOp, skipPublish: true });
    expect((await listCoManagedOpenConversationDrafts(db, alice.actor, alice.resource)).find(d => d.operationId === privateOp))
      .toMatchObject({ storeTenant: customer, audience: 'organization_private' });
    // discarded and published drafts are not restored
    await abandonCoManagedConversationDraft(db, alice.actor, alice.resource, privateDraft.reference);
    const published = await post(alice, { audience: 'shared_it', text: `restore done ${MARK}`, files: [file(`restore-d-${MARK}.bin`)] });
    const after = (await listCoManagedOpenConversationDrafts(db, alice.actor, alice.resource)).map(d => d.operationId);
    expect(after).toContain(operationId);
    expect(after).not.toContain(privateOp);
    expect(after).not.toContain(published.operationId);
  });
});

describe('A3 draft resume survives the jsonb key reordering of the stored request', () => {
  it('a restored draft re-begins as the same draft (no operationConflict) and then publishes', async () => {
    const { beginCoManagedConversationDraft, uploadCoManagedDraftAttachment, publishCoManagedConversationDraft, listCoManagedOpenConversationDrafts } = await drafts();
    const { restoreConversationDraft } = await import('../../components/co-managed/conversationDraftSubmission');
    const operationId = uuidv4(), attached = file(`resume-${MARK}.pdf`);
    // BlockNote key order: props backgroundColor, textColor, textAlignment; text node type, text, styles. jsonb stores keys by length then
    // bytes, so reading this back yields a different order.
    const document = [{ type: 'paragraph', props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
      content: [{ type: 'text', text: `resume ${MARK}`, styles: { bold: true } }] }];
    const request: any = { operationId, audience: 'shared_it', content: { document }, files: manifestOf([attached]) };
    const begun = await beginCoManagedConversationDraft(db, alice.actor, alice.resource, request);
    await uploadCoManagedDraftAttachment(db, alice.actor, alice.resource, { storeTenant: begun.storeTenant, operationId }, attached.id, attached.bytes, putObject);

    const stored = (await listCoManagedOpenConversationDrafts(db, alice.actor, alice.resource)).find(d => d.operationId === operationId)!;
    expect(JSON.stringify(stored.content)).not.toBe(JSON.stringify(request.content)); // the premise: the database reordered the keys
    const restored = restoreConversationDraft(alice.resource, stored, []);
    if (!restored.ok) throw new Error('expected a restorable draft');

    const again = await beginCoManagedConversationDraft(db, alice.actor, alice.resource, restored.prepared.request);
    expect(again).toMatchObject({ operationId, storeTenant: begun.storeTenant, status: 'draft', uploadedAttachmentIds: [attached.id] });
    const rows = await db('co_management_conversation_drafts').where({ tenant: msp.tenant, operation_id: operationId });
    expect(rows).toHaveLength(1);

    await publishCoManagedConversationDraft(db, alice.actor, alice.resource, { storeTenant: again.storeTenant, operationId }, sharedWith as any);
    expect(await db('co_management_conversation_drafts').where({ tenant: msp.tenant, operation_id: operationId }).first()).toMatchObject({ status: 'published' });
  });
});
