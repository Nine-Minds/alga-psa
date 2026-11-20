import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { prosemirrorJSONToYXmlFragment } from 'y-prosemirror';
import { schema } from 'prosemirror-schema-basic';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';
import { tenantDb } from '@alga-psa/db';
import { createServer, type Server as HttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';
import { POST as persistRoute } from '@/app/api/internal/collab/persist/route';
import { POST as authorizeRoute } from '@/app/api/internal/collab/authorize/route';
import { CollabPersistenceExtension } from '../../../../hocuspocus/CollabPersistenceExtension.js';
import { validateDocumentRoomAccess, validateDocumentRoomToken } from '../../../../hocuspocus/tenantValidation.js';
import { signDocumentRoomToken } from '@shared/lib/documentRoomToken';
import type { Hocuspocus } from '../../../../hocuspocus/node_modules/@hocuspocus/server';

/**
 * Collaborative Editing — Integration Tests
 *
 * Tests the server-side components of collaborative editing:
 * - Document creation for collaborative sessions
 * - Snapshot sync from Y.js state back to document_block_content
 * - Feature flag gating
 * - Tenant isolation in room name construction
 *
 * These tests own a real WebSocket server and migrated database. The production
 * persistence extension calls the real route over HTTP; database routing and
 * browser-session authentication are fixture seams. Redis fanout and the
 * built Hocuspocus container have separate coverage.
 *
 * Run: npm run test:integration -- collaborativeEditing
 */

let db: Knex;
let tenantId: string;
let userId: string;
let secondTenantId: string;
let secondUserId: string;
let secondSameTenantUserId: string;
const deniedWriterIds = new Set<string>();


function tenantTable(tenant: string, table: string) {
  return tenantDb(db, tenant).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

// Mock createTenantKnex to use test DB
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    withTransaction: actual.withTransaction,
  };
});

// Mock auth to return our test user
vi.mock('@alga-psa/auth', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/auth')>('@alga-psa/auth');
  return {
    ...actual,
    withAuth: vi.fn((fn: Function) => {
      return (...args: any[]) => {
        const user = { user_id: userId, tenant: tenantId };
        const ctx = { tenant: tenantId };
        return fn(user, ctx, ...args);
      };
    }),
    hasPermission: vi.fn((user: any) => Promise.resolve(!deniedWriterIds.has(user.user_id))),
    getSession: vi.fn(() => Promise.resolve({ user: { id: userId, tenant: tenantId } })),
  };
});

// Mock event publishing (not relevant to collab tests)
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

describe('Collaborative Editing — Integration Tests', () => {
  const HOOK_TIMEOUT = 120_000;

  beforeAll(async () => {
    db = await createTestDbConnection();

    // Create two tenants to test isolation
    tenantId = await createTenant(db, 'Collab Test MSP');
    userId = await createUser(db, tenantId, {
      first_name: 'Editor',
      last_name: 'One',
      email: 'editor1@test.com',
    });
    secondSameTenantUserId = await createUser(db, tenantId, {
      first_name: 'Editor',
      last_name: 'Two',
      email: 'editor2@test.com',
    });

    secondTenantId = await createTenant(db, 'Other MSP');
    secondUserId = await createUser(db, secondTenantId, {
      first_name: 'Editor',
      last_name: 'Two',
      email: 'editor2@test.com',
    });

    const permissionIds = [uuidv4(), uuidv4()];
    const roleId = uuidv4();
    await db('roles').insert({ tenant: tenantId, role_id: roleId, role_name: 'Collab Test Editor', msp: true, client: false });
    await db('user_roles').insert([
      { tenant: tenantId, user_id: userId, role_id: roleId },
      { tenant: tenantId, user_id: secondSameTenantUserId, role_id: roleId },
    ]);
    await db('permissions').insert([
      { tenant: tenantId, permission_id: permissionIds[0], resource: 'document', action: 'read', msp: true, client: false },
      { tenant: tenantId, permission_id: permissionIds[1], resource: 'document', action: 'update', msp: true, client: false },
    ]);
    await db('role_permissions').insert(permissionIds.map(permission_id => ({ tenant: tenantId, role_id: roleId, permission_id })));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      // A migrated suite must not hide missing tables or failed cleanup.
      await db('role_permissions').where({ tenant: tenantId }).del();
      await db('user_roles').where({ tenant: tenantId }).del();
      await db('permissions').where({ tenant: tenantId }).del();
      await db('roles').where({ tenant: tenantId }).del();
      for (const table of ['document_block_content', 'documents', 'users', 'tenants']) {
        if (table === 'tenants') {
          await tenantRows().whereIn('tenant', [tenantId, secondTenantId]).del();
        } else {
          await tenantTable(tenantId, table).where({ tenant: tenantId }).del();
          await tenantTable(secondTenantId, table).where({ tenant: secondTenantId }).del();
        }
      }
    } finally {
      await db?.destroy();
    }
  }, HOOK_TIMEOUT);

  // ─── Document Creation for Collab Sessions ───────────────────────

  describe('Document creation for collaborative sessions', () => {
    let testDocId: string;

    afterEach(async () => {
      if (testDocId) {
        await tenantTable(tenantId, 'document_block_content').where({ document_id: testDocId, tenant: tenantId }).del();
        await tenantTable(tenantId, 'documents').where({ document_id: testDocId, tenant: tenantId }).del();
        testDocId = '';
      }
    });

    it('should create a document with empty block_data for a new collab session', async () => {
      testDocId = uuidv4();
      const now = db.fn.now();

      await tenantTable(tenantId, 'documents').insert({
        document_id: testDocId,
        document_name: 'Collab Test Doc',
        user_id: userId,
        created_by: userId,
        tenant: tenantId,
        order_number: 0,
        entered_at: now,
        updated_at: now,
      });

      await tenantTable(tenantId, 'document_block_content').insert({
        content_id: uuidv4(),
        document_id: testDocId,
        block_data: JSON.stringify({ type: 'doc', content: [] }),
        tenant: tenantId,
        created_at: now,
        updated_at: now,
      });

      const doc = await tenantTable(tenantId, 'documents').where({ document_id: testDocId, tenant: tenantId }).first();
      expect(doc).toBeDefined();
      expect(doc.document_name).toBe('Collab Test Doc');

      const content = await tenantTable(tenantId, 'document_block_content')
        .where({ document_id: testDocId, tenant: tenantId })
        .first();
      expect(content).toBeDefined();
      expect(content.block_data).toBeDefined();
    });

    it('should enforce tenant in document_block_content composite key', async () => {
      testDocId = uuidv4();
      const now = db.fn.now();

      await tenantTable(tenantId, 'documents').insert({
        document_id: testDocId,
        document_name: 'Tenant Isolation Doc',
        user_id: userId,
        created_by: userId,
        tenant: tenantId,
        order_number: 0,
        entered_at: now,
        updated_at: now,
      });

      await tenantTable(tenantId, 'document_block_content').insert({
        content_id: uuidv4(),
        document_id: testDocId,
        block_data: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
        tenant: tenantId,
        created_at: now,
        updated_at: now,
      });

      // Query with wrong tenant should return nothing
      const wrongTenant = await tenantTable(secondTenantId, 'document_block_content')
        .where({ document_id: testDocId, tenant: secondTenantId })
        .first();
      expect(wrongTenant).toBeUndefined();

      // Query with correct tenant should return the content
      const correctTenant = await tenantTable(tenantId, 'document_block_content')
        .where({ document_id: testDocId, tenant: tenantId })
        .first();
      expect(correctTenant).toBeDefined();
    });
  });

  // ─── Snapshot Sync (Y.js → Main DB) ─────────────────────────────

  describe('Snapshot sync: writing Y.js state back to document_block_content', () => {
    let testDocId: string;

    beforeEach(async () => {
      testDocId = uuidv4();
      const now = db.fn.now();

      await tenantTable(tenantId, 'documents').insert({
        document_id: testDocId,
        document_name: 'Snapshot Test Doc',
        user_id: userId,
        created_by: userId,
        tenant: tenantId,
        order_number: 0,
        entered_at: now,
        updated_at: now,
      });

      await tenantTable(tenantId, 'document_block_content').insert({
        content_id: uuidv4(),
        document_id: testDocId,
        block_data: JSON.stringify({ type: 'doc', content: [] }),
        tenant: tenantId,
        created_at: now,
        updated_at: now,
      });
    });

    afterEach(async () => {
      await tenantTable(tenantId, 'document_block_content').where({ document_id: testDocId, tenant: tenantId }).del();
      await tenantTable(tenantId, 'documents').where({ document_id: testDocId, tenant: tenantId }).del();
    });

    it('should update block_data when syncing a snapshot from collab state', async () => {
      const collabContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Collaboratively edited content' }],
          },
        ],
      };

      const [updated] = await tenantTable(tenantId, 'document_block_content')
        .where({ document_id: testDocId, tenant: tenantId })
        .update({
          block_data: JSON.stringify(collabContent),
          updated_at: db.fn.now(),
        })
        .returning(['content_id', 'block_data']);

      expect(updated).toBeDefined();

      // Verify the snapshot was written correctly
      const content = await tenantTable(tenantId, 'document_block_content')
        .where({ document_id: testDocId, tenant: tenantId })
        .first();

      const parsed = typeof content.block_data === 'string'
        ? JSON.parse(content.block_data)
        : content.block_data;
      expect(parsed.content[0].content[0].text).toBe('Collaboratively edited content');
    });

    it('should preserve document metadata when syncing snapshot', async () => {
      const beforeSync = await tenantTable(tenantId, 'documents')
        .where({ document_id: testDocId, tenant: tenantId })
        .first();

      // Simulate snapshot sync — only updates block_content, not the document record
      await tenantTable(tenantId, 'document_block_content')
        .where({ document_id: testDocId, tenant: tenantId })
        .update({
          block_data: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
          updated_at: db.fn.now(),
        });

      const afterSync = await tenantTable(tenantId, 'documents')
        .where({ document_id: testDocId, tenant: tenantId })
        .first();

      expect(afterSync.document_name).toBe(beforeSync.document_name);
      expect(afterSync.created_by).toBe(beforeSync.created_by);
    });
  });

  // ─── Hocuspocus Room Name Construction ───────────────────────────

  describe('Room name construction and tenant isolation', () => {
    it('should construct room name as document:<tenant>:<documentId>', () => {
      const docId = uuidv4();
      const roomName = `document:${tenantId}:${docId}`;

      expect(roomName).toMatch(/^document:[0-9a-f-]+:[0-9a-f-]+$/);

      const [prefix, roomTenant, roomDocId] = roomName.split(':');
      expect(prefix).toBe('document');
      expect(roomTenant).toBe(tenantId);
      expect(roomDocId).toBe(docId);
    });

    it('should produce different room names for same doc in different tenants', () => {
      const docId = uuidv4();
      const room1 = `document:${tenantId}:${docId}`;
      const room2 = `document:${secondTenantId}:${docId}`;

      expect(room1).not.toBe(room2);
    });

    it('should reject room name with mismatched tenant', () => {
      // Simulates the onConnect validation logic
      const connectingTenant = tenantId;
      const roomName = `document:${secondTenantId}:${uuidv4()}`;

      const [, roomTenant] = roomName.split(':');
      const isAllowed = roomTenant === connectingTenant;

      expect(isAllowed).toBe(false);
    });

    it('should allow room name with matching tenant', () => {
      const connectingTenant = tenantId;
      const roomName = `document:${tenantId}:${uuidv4()}`;

      const [, roomTenant] = roomName.split(':');
      const isAllowed = roomTenant === connectingTenant;

      expect(isAllowed).toBe(true);
    });

    it('should pass through notification rooms without document validation', () => {
      const roomName = `notifications:${tenantId}:${userId}`;
      const isDocumentRoom = roomName.startsWith('document:');

      expect(isDocumentRoom).toBe(false);
      // Non-document rooms skip tenant validation
    });
  });

  // ─── Feature Flag Default ────────────────────────────────────────

  describe('Feature flag configuration', () => {
    it('should have collaborative_editing flag defaulting to false', async () => {
      // This test verifies the flag is registered — import the defaults directly
      const { featureFlags } = await import('@/lib/feature-flags/featureFlags');

      // When PostHog is unavailable (test env), it falls back to defaults
      const enabled = await featureFlags.isEnabled('collaborative_editing');
      expect(enabled).toBe(false);
    });
  });

  // ─── Y.js Document Initialization ────────────────────────────────

  describe('Y.js document initialization from existing content', () => {
    let testDocId: string;

    beforeEach(async () => {
      testDocId = uuidv4();
      const now = db.fn.now();

      const existingContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Pre-existing document content' }],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Section Title' }],
          },
        ],
      };

      await tenantTable(tenantId, 'documents').insert({
        document_id: testDocId,
        document_name: 'Existing Doc',
        user_id: userId,
        created_by: userId,
        tenant: tenantId,
        order_number: 0,
        entered_at: now,
        updated_at: now,
      });

      await tenantTable(tenantId, 'document_block_content').insert({
        content_id: uuidv4(),
        document_id: testDocId,
        block_data: JSON.stringify(existingContent),
        tenant: tenantId,
        created_at: now,
        updated_at: now,
      });
    });

    afterEach(async () => {
      await tenantTable(tenantId, 'document_block_content').where({ document_id: testDocId, tenant: tenantId }).del();
      await tenantTable(tenantId, 'documents').where({ document_id: testDocId, tenant: tenantId }).del();
    });

    it('should load existing block_data as TipTap-compatible JSON for Y.js initialization', async () => {
      const content = await tenantTable(tenantId, 'document_block_content')
        .where({ document_id: testDocId, tenant: tenantId })
        .first();

      expect(content).toBeDefined();

      const parsed = typeof content.block_data === 'string'
        ? JSON.parse(content.block_data)
        : content.block_data;

      // Verify it's valid TipTap JSON structure
      expect(parsed).toHaveProperty('type', 'doc');
      expect(parsed).toHaveProperty('content');
      expect(Array.isArray(parsed.content)).toBe(true);
      expect(parsed.content.length).toBeGreaterThan(0);

      // Verify content types are TipTap-compatible node types
      const nodeTypes = parsed.content.map((node: any) => node.type);
      expect(nodeTypes).toEqual(expect.arrayContaining(['paragraph', 'heading']));
    });

    it('should return null block_data for non-existent document', async () => {
      const content = await tenantTable(tenantId, 'document_block_content')
        .where({ document_id: uuidv4(), tenant: tenantId })
        .first();

      expect(content).toBeUndefined();
    });
  });

  describe('Hocuspocus synchronization and persistence', () => {
    let service: Hocuspocus;
    let http: HttpServer;
    let url: string;
    let apiUrl: string;
    let authApiUrl: string;
    const providers = new Set<HocuspocusProvider>();
    const documents = new Set<Y.Doc>();
    const renewalStops = new Set<() => void>();
    const requests: Array<{ status: number; path: string }> = [];
    const transportErrors: Error[] = [];
    let expectedStatuses: number[];

    beforeEach(() => {
      expectedStatuses = [200];
      deniedWriterIds.clear();
    });

    beforeAll(async () => {
      vi.stubEnv('COLLAB_PERSIST_API_KEY', uuidv4());
      http = createServer(async (incoming, outgoing) => {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
          const path = new URL(incoming.url ?? '/', 'http://localhost').pathname;
          const request = new NextRequest(`http://localhost${path}`, {
            method: 'POST',
            headers: { 'x-api-key': String(incoming.headers['x-api-key'] ?? '') },
            body: Buffer.concat(chunks).toString(),
          });
          const result = path.endsWith('/authorize') ? await authorizeRoute(request) : await persistRoute(request);
          requests.push({ status: result.status, path });
          outgoing.writeHead(result.status, Object.fromEntries(result.headers.entries()));
          outgoing.end(await result.text());
        } catch (error) {
          transportErrors.push(error as Error);
          outgoing.writeHead(500); outgoing.end('Persistence request failed');
        }
      });
      await new Promise<void>((resolve, reject) => {
        http.once('error', reject);
        http.listen(0, '127.0.0.1', resolve);
      });
      const apiBase = `http://127.0.0.1:${(http.address() as AddressInfo).port}/api/internal/collab`;
      apiUrl = `${apiBase}/persist`;
      authApiUrl = `${apiBase}/authorize`;
      // Resolve the service's own locked server version, not a test replacement.
      const requireService = createRequire(new URL('../../../../hocuspocus/package.json', import.meta.url));
      const { Hocuspocus } = await import(pathToFileURL(requireService.resolve('@hocuspocus/server')).href);
      service = new Hocuspocus({
        address: '127.0.0.1', port: 0, quiet: true,
        debounce: 20, maxDebounce: 100,
        extensions: [new CollabPersistenceExtension({ apiUrl, authorizationUrl: authApiUrl, apiKey: process.env.COLLAB_PERSIST_API_KEY })],
        onAuthenticate: async ({ documentName, token }: { documentName: string; token: string }) => {
          const admission = validateDocumentRoomToken(documentName, token);
          const authorized = await fetch(authApiUrl, {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.COLLAB_PERSIST_API_KEY! },
            body: JSON.stringify({ tenantId: admission.tenantId, documentId: admission.documentId, credential: token }),
          });
          if (!authorized.ok) throw new Error('Document update authorization denied');
          return { ...admission, documentRoomToken: token };
        },
        onConnect: ({ documentName, request, context }: { documentName: string; request: unknown; context: any }) => {
          validateDocumentRoomAccess(documentName, request, {
            credential: context?.documentRoomToken,
            allowPendingAuthentication: true,
          });
        },
      });
      await service.listen();
      url = `ws://127.0.0.1:${service.address.port}`;
      vi.stubEnv('NEXT_PUBLIC_HOCUSPOCUS_URL', url);
      vi.stubEnv('HOCUSPOCUS_INTERNAL_URL', url);
    });

    afterEach(async () => {
      for (const stop of renewalStops) stop();
      renewalStops.clear();
      for (const provider of providers) provider.destroy();
      for (const document of documents) document.destroy();
      providers.clear(); documents.clear();
      await tenantTable(tenantId, 'users').where({ user_id: userId }).update({ is_inactive: false });
      await expect.poll(() => service.getConnectionsCount(), { timeout: 5000 }).toBe(0);
      await expect.poll(() => service.getDocumentsCount(), { timeout: 5000 }).toBe(0);
      expect(transportErrors).toEqual([]);
      expect(requests.every(request => expectedStatuses.includes(request.status))).toBe(true);
      requests.length = 0;
    });

    afterAll(async () => {
      await service?.destroy();
      if (http?.listening) await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
      vi.unstubAllEnvs();
    });

    function connect(room: string, connectingTenant = tenantId, principal = userId, credentialOverride?: string) {
      const document = new Y.Doc(); documents.add(document);
      const documentId = room.split(':')[2];
      const credential = credentialOverride ?? signDocumentRoomToken({ tenantId: connectingTenant, documentId, userId: principal });
      const provider = new HocuspocusProvider({
        url, name: room, document, parameters: { tenantId: connectingTenant, userId: principal }, token: credential,
        preserveConnection: false,
      });
      providers.add(provider);
      return { document, provider };
    }

    async function synced(provider: HocuspocusProvider) {
      await expect.poll(() => provider.synced, { timeout: 5000 }).toBe(true);
    }

    function write(document: Y.Doc, text: string) {
      prosemirrorJSONToYXmlFragment(schema, {
        type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      }, document.getXmlFragment('prosemirror'));
    }

    async function seedDocument() {
      const documentId = uuidv4();
      await tenantTable(tenantId, 'documents').insert({
        document_id: documentId, document_name: 'Live collaborative snapshot', tenant: tenantId,
        user_id: userId, created_by: userId, entered_at: db.fn.now(), updated_at: db.fn.now(),
      });
      await tenantTable(tenantId, 'document_block_content').insert({
        content_id: uuidv4(), document_id: documentId, tenant: tenantId,
        block_data: JSON.stringify({ type: 'doc', content: [] }),
        created_at: db.fn.now(), updated_at: db.fn.now(),
      });
      return documentId;
    }

    async function saved(documentId: string) {
      const row = await tenantTable(tenantId, 'document_block_content').where({ document_id: documentId }).first();
      return typeof row.block_data === 'string' ? JSON.parse(row.block_data) : row.block_data;
    }

    function shortLivedCredential(documentId: string) {
      const token = jwt.sign({
        tenantId,
        documentId,
        userId,
        scope: 'document-room',
      }, process.env.HOCUSPOCUS_JWT_SECRET || 'dev-hocuspocus-jwt-secret', {
        algorithm: 'HS256', audience: 'document-room', issuer: 'alga-psa',
        expiresIn: 4, jwtid: uuidv4(),
      });
      const claims = jwt.decode(token) as jwt.JwtPayload;
      return { token, expiresAt: claims.exp! * 1000 };
    }

    async function connectWithRenewal(room: string, issueCredential: () => Promise<{ token: string; expiresAt: number }>) {
      const document = new Y.Doc(); documents.add(document);
      const provider = new HocuspocusProvider({
        url, name: room, document, parameters: { tenantId, userId }, preserveConnection: false,
      });
      providers.add(provider);
      const { startDocumentRoomConnection } = await import('@alga-psa/documents/lib/documentRoomConnection');
      const connection = startDocumentRoomConnection(provider, issueCredential, error => {
        transportErrors.push(error instanceof Error ? error : new Error(String(error)));
      });
      renewalStops.add(connection.stop);
      await connection.ready;
      return { document, provider };
    }

    it('persists editor content after the last client disconnects and the room is evicted', async () => {
      const documentId = await seedDocument();
      const room = `document:${tenantId}:${documentId}`;
      const first = connect(room);
      await synced(first.provider);
      write(first.document, 'Persisted content');
      await expect.poll(() => first.provider.hasUnsyncedChanges, { timeout: 5000 }).toBe(false);
      first.provider.destroy(); providers.delete(first.provider);
      await expect.poll(() => service.documents.has(room), { timeout: 5000 }).toBe(false);
      await expect.poll(async () => (await saved(documentId)).content?.[0]?.content?.[0]?.text).toBe('Persisted content');
      expect(requests.some(request => request.status === 200)).toBe(true);

      // A fresh server-side snapshot of the empty room must not wipe durable content.
      const { syncCollabSnapshot } = await import('@alga-psa/documents/actions/collaborativeEditingActions');
      expect(await syncCollabSnapshot(documentId)).toMatchObject({ success: false });
      expect((await saved(documentId)).content[0].content[0].text).toBe('Persisted content');
    });

    it('syncs content between two providers connected to the same room', async () => {
      const room = `document:${tenantId}:${await seedDocument()}`;
      const first = connect(room), second = connect(room);
      await Promise.all([synced(first.provider), synced(second.provider)]);
      first.document.getText('test').insert(0, 'Hello from A');
      await expect.poll(() => second.document.getText('test').toString()).toBe('Hello from A');
      second.document.getText('test').insert('Hello from A'.length, ' and B');
      await expect.poll(() => first.document.getText('test').toString()).toBe('Hello from A and B');
    });

    it('broadcasts awareness state between providers', async () => {
      const room = `document:${tenantId}:${await seedDocument()}`;
      const first = connect(room), second = connect(room);
      await Promise.all([synced(first.provider), synced(second.provider)]);
      first.provider.awareness!.setLocalStateField('user', { id: userId, name: 'Editor One', color: '#ff0000' });
      await expect.poll(() => Array.from(second.provider.awareness!.getStates().values())
        .some(state => state.user?.id === userId)).toBe(true);
    });

    it('rejects a mismatched tenant before synchronizing room content', async () => {
      const room = `document:${tenantId}:${await seedDocument()}`;
      const owner = connect(room);
      await synced(owner.provider);
      owner.document.getText('test').insert(0, 'Private document');
      await expect.poll(() => owner.provider.hasUnsyncedChanges).toBe(false);
      const intruder = connect(room, secondTenantId);
      let closed = false;
      intruder.provider.on('close', () => { closed = true; });
      await expect.poll(() => closed, { timeout: 5000 }).toBe(true);
      expect(intruder.provider.synced).toBe(false);
      expect(intruder.document.getText('test').toString()).toBe('');
    });

    it('saves a live room through syncCollabSnapshot into document_block_content', async () => {
      const documentId = await seedDocument();
      const owner = connect(`document:${tenantId}:${documentId}`);
      await synced(owner.provider);
      write(owner.document, 'Snapshot content');
      await expect.poll(() => owner.provider.hasUnsyncedChanges).toBe(false);
      const { syncCollabSnapshot } = await import('@alga-psa/documents/actions/collaborativeEditingActions');
      expect(await syncCollabSnapshot(documentId)).toMatchObject({ success: true });
      expect((await saved(documentId)).content[0].content[0].text).toBe('Snapshot content');
      expect(await tenantTable(secondTenantId, 'document_block_content').where({ document_id: documentId }).first()).toBeUndefined();
    });

    it('rejects unauthenticated and wrong-tenant persistence without changing stored content', async () => {
      expectedStatuses = [400, 401, 403];
      const documentId = await seedDocument();
      const before = await saved(documentId);
      const document = new Y.Doc(); documents.add(document);
      write(document, 'Must not be saved');
      const update = Buffer.from(Y.encodeStateAsUpdate(document)).toString('base64');
      const credential = signDocumentRoomToken({ tenantId, documentId, userId });
      const send = (key: string, tenant: string, roomCredential?: string) => fetch(apiUrl, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ tenantId: tenant, documentId, update, credential: roomCredential }),
      });
      expect((await send('invalid-test-key', tenantId, credential)).status).toBe(401);
      expect(await saved(documentId)).toEqual(before);
      expect((await send(process.env.COLLAB_PERSIST_API_KEY!, secondTenantId, credential)).status).toBe(403);
      expect((await send(process.env.COLLAB_PERSIST_API_KEY!, tenantId)).status).toBe(400);
      expect((await send(process.env.COLLAB_PERSIST_API_KEY!, tenantId, 'forged.credential.value')).status).toBe(403);
      expect(await saved(documentId)).toEqual(before);
      expect(requests.map(request => request.status)).toEqual([401, 403, 400, 403]);
    });

    it('denies unauthorized room writers and forged credentials before they join a shared room', async () => {
      expectedStatuses = [200, 403];
      const documentId = await seedDocument();
      const room = `document:${tenantId}:${documentId}`;
      const owner = connect(room);
      await synced(owner.provider);

      deniedWriterIds.add(secondSameTenantUserId);
      const deniedCredential = signDocumentRoomToken({ tenantId, documentId, userId: secondSameTenantUserId });
      const denied = connect(room, tenantId, userId, deniedCredential);
      let deniedClosed = false;
      denied.provider.on('close', () => { deniedClosed = true; });
      await expect.poll(() => deniedClosed, { timeout: 5000 }).toBe(true);
      expect(denied.document.getXmlFragment('prosemirror').length).toBe(0);

      const forged = connect(room, tenantId, userId, 'forged.credential.value');
      let forgedClosed = false;
      forged.provider.on('close', () => { forgedClosed = true; });
      await expect.poll(() => forgedClosed, { timeout: 5000 }).toBe(true);
      expect(forged.document.getXmlFragment('prosemirror').length).toBe(0);

      write(owner.document, 'Only the authorized writer can change this room');
      await expect.poll(() => owner.provider.hasUnsyncedChanges).toBe(false);
      owner.provider.destroy(); providers.delete(owner.provider);
      await expect.poll(() => service.documents.has(room), { timeout: 5000 }).toBe(false);
      expect((await saved(documentId)).content[0].content[0].text)
        .toBe('Only the authorized writer can change this room');
      expect(requests.some(request => request.status === 403)).toBe(true);
    });

    it('rechecks a connected writer at message and persistence boundaries after access is revoked', async () => {
      expectedStatuses = [200, 403];
      const documentId = await seedDocument();
      const room = `document:${tenantId}:${documentId}`;
      const editor = connect(room);
      await synced(editor.provider);
      write(editor.document, 'Authorized first change');
      await expect.poll(() => editor.provider.hasUnsyncedChanges).toBe(false);
      await expect.poll(async () => (await saved(documentId)).content?.[0]?.content?.[0]?.text)
        .toBe('Authorized first change');

      const storedBeforeDenial = await tenantTable(tenantId, 'document_block_content')
        .where({ document_id: documentId }).first();
      const metadataBeforeDenial = await tenantTable(tenantId, 'documents')
        .where({ document_id: documentId }).select('updated_at', 'edited_by').first();
      deniedWriterIds.add(userId);
      let connectionClosed = false;
      editor.provider.on('close', () => { connectionClosed = true; });
      write(editor.document, 'Revoked change must not persist');
      await expect.poll(() => connectionClosed || requests.some(request => request.status === 403), { timeout: 5000 })
        .toBe(true);
      editor.provider.destroy(); providers.delete(editor.provider);
      await expect.poll(() => service.documents.has(room), { timeout: 5000 }).toBe(false);

      const storedAfterDenial = await tenantTable(tenantId, 'document_block_content')
        .where({ document_id: documentId }).first();
      const metadataAfterDenial = await tenantTable(tenantId, 'documents')
        .where({ document_id: documentId }).select('updated_at', 'edited_by').first();
      expect(storedAfterDenial.block_data).toEqual(storedBeforeDenial.block_data);
      expect(storedAfterDenial.updated_at).toEqual(storedBeforeDenial.updated_at);
      expect(metadataAfterDenial).toEqual(metadataBeforeDenial);
      expect(requests.some(request => request.status === 403)).toBe(true);

      deniedWriterIds.delete(userId);
      const recovered = connect(room);
      await synced(recovered.provider);
      write(recovered.document, 'Editing recovers after access returns');
      await expect.poll(() => recovered.provider.hasUnsyncedChanges).toBe(false);
      recovered.provider.destroy(); providers.delete(recovered.provider);
      await expect.poll(() => service.documents.has(room), { timeout: 5000 }).toBe(false);
      expect((await saved(documentId)).content[0].content[0].text)
        .toBe('Editing recovers after access returns');
    });

    it('renews an expiring credential and preserves pending edits through reconnect and room unload', async () => {
      const documentId = await seedDocument();
      const room = `document:${tenantId}:${documentId}`;
      let tokenCalls = 0;
      let firstExpiresAt = 0;
      let firstToken = '';
      let releaseRenewal!: () => void;
      let renewalStarted!: () => void;
      const renewalStartedPromise = new Promise<void>(resolve => { renewalStarted = resolve; });
      const renewalGate = new Promise<void>(resolve => { releaseRenewal = resolve; });
      const issueCredential = async () => {
        tokenCalls += 1;
        if (tokenCalls === 2) {
          renewalStarted();
          await renewalGate;
        }
        const credential = shortLivedCredential(documentId);
        if (tokenCalls === 1) {
          firstExpiresAt = credential.expiresAt;
          firstToken = credential.token;
        }
        return credential;
      };

      const editor = await connectWithRenewal(room, issueCredential);
      await synced(editor.provider);
      await expect(renewalStartedPromise).resolves.toBeUndefined();

      // Simulate a dropped socket while a refresh is in flight. The update is
      // now only in the provider's Y.Doc and must survive the credential swap.
      editor.provider.disconnect();
      await expect.poll(() => editor.provider.isConnected).toBe(false);
      write(editor.document, 'Pending edit survives credential rotation');
      expect(editor.document.getXmlFragment('prosemirror').length).toBeGreaterThan(0);
      releaseRenewal();

      await expect.poll(() => tokenCalls >= 2 && editor.provider.isConnected && editor.provider.synced, { timeout: 5000 })
        .toBe(true);
      await expect.poll(() => Date.now() > firstExpiresAt, { timeout: 5000 }).toBe(true);
      expect(editor.provider.isConnected).toBe(true);
      expect(editor.provider.synced).toBe(true);
      expect(tokenCalls).toBeGreaterThanOrEqual(2);
      expect(() => validateDocumentRoomToken(room, firstToken)).toThrow();

      editor.provider.destroy(); providers.delete(editor.provider);
      await expect.poll(() => service.documents.has(room), { timeout: 5000 }).toBe(false);
      await expect.poll(async () => (await saved(documentId)).content?.[0]?.content?.[0]?.text, { timeout: 5000 })
        .toBe('Pending edit survives credential rotation');
      expect(requests.some(request => request.path.endsWith('/persist') && request.status === 200)).toBe(true);
    });

    it('denies inactive writers issued credentials before admission and after connection, then recovers on reactivation', async () => {
      expectedStatuses = [200, 403];
      const documentId = await seedDocument();
      const room = `document:${tenantId}:${documentId}`;
      const credential = signDocumentRoomToken({ tenantId, documentId, userId });
      const storedBefore = await tenantTable(tenantId, 'document_block_content').where({ document_id: documentId }).first();
      const metadataBefore = await tenantTable(tenantId, 'documents')
        .where({ document_id: documentId }).select('updated_at', 'edited_by').first();

      await tenantTable(tenantId, 'users').where({ user_id: userId }).update({ is_inactive: true });
      const admission = await authorizeRoute(new NextRequest(authApiUrl, {
        method: 'POST', headers: { 'x-api-key': process.env.COLLAB_PERSIST_API_KEY!, 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, documentId, credential }),
      }));
      expect(admission.status).toBe(403);
      const denied = connect(room, tenantId, userId, credential);
      let deniedClosed = false;
      denied.provider.on('close', () => { deniedClosed = true; });
      await expect.poll(() => deniedClosed, { timeout: 5000 }).toBe(true);
      expect(await tenantTable(tenantId, 'document_block_content').where({ document_id: documentId }).first())
        .toMatchObject({ block_data: storedBefore.block_data, updated_at: storedBefore.updated_at });
      expect(await tenantTable(tenantId, 'documents').where({ document_id: documentId })
        .select('updated_at', 'edited_by').first()).toEqual(metadataBefore);

      await tenantTable(tenantId, 'users').where({ user_id: userId }).update({ is_inactive: false });
      const editor = connect(room);
      await synced(editor.provider);
      write(editor.document, 'Authorized before deactivation');
      await expect.poll(() => editor.provider.hasUnsyncedChanges).toBe(false);
      await expect.poll(async () => (await saved(documentId)).content?.[0]?.content?.[0]?.text)
        .toBe('Authorized before deactivation');
      const activeSnapshot = await tenantTable(tenantId, 'document_block_content').where({ document_id: documentId }).first();
      const activeMetadata = await tenantTable(tenantId, 'documents')
        .where({ document_id: documentId }).select('updated_at', 'edited_by').first();

      await tenantTable(tenantId, 'users').where({ user_id: userId }).update({ is_inactive: true });
      const requestsBeforeRevocation = requests.length;
      let revokedClosed = false;
      editor.provider.on('close', () => { revokedClosed = true; });
      write(editor.document, 'Inactive edit must not persist');
      await expect.poll(() => revokedClosed || requests.slice(requestsBeforeRevocation).some(request => request.status === 403), { timeout: 5000 })
        .toBe(true);

      const attempted = new Y.Doc(); documents.add(attempted);
      write(attempted, 'Inactive internal persistence must be denied');
      const update = Buffer.from(Y.encodeStateAsUpdate(attempted)).toString('base64');
      const persistenceResponse = await fetch(apiUrl, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.COLLAB_PERSIST_API_KEY! },
        body: JSON.stringify({ tenantId, documentId, update, credential }),
      });
      expect(persistenceResponse.status).toBe(403);
      editor.provider.destroy(); providers.delete(editor.provider);
      await expect.poll(() => service.documents.has(room), { timeout: 5000 }).toBe(false);
      expect(await tenantTable(tenantId, 'document_block_content').where({ document_id: documentId }).first())
        .toMatchObject({ block_data: activeSnapshot.block_data, updated_at: activeSnapshot.updated_at });
      expect(await tenantTable(tenantId, 'documents').where({ document_id: documentId })
        .select('updated_at', 'edited_by').first()).toEqual(activeMetadata);
      expect(requests.slice(requestsBeforeRevocation).some(request => request.status === 403)).toBe(true);

      await tenantTable(tenantId, 'users').where({ user_id: userId }).update({ is_inactive: false });
      const recovered = connect(room);
      await synced(recovered.provider);
      write(recovered.document, 'Editing recovers after reactivation');
      await expect.poll(() => recovered.provider.hasUnsyncedChanges).toBe(false);
      recovered.provider.destroy(); providers.delete(recovered.provider);
      await expect.poll(() => service.documents.has(room), { timeout: 5000 }).toBe(false);
      expect((await saved(documentId)).content[0].content[0].text).toBe('Editing recovers after reactivation');
      await tenantTable(tenantId, 'users').where({ user_id: userId }).update({ is_inactive: false });
    });

    it('rejects redacted room admission and persistence without changing content or metadata', async () => {
      expectedStatuses = [200, 403];
      const documentId = await seedDocument();
      const storedBefore = await tenantTable(tenantId, 'document_block_content')
        .where({ document_id: documentId }).first();
      const metadataBefore = await tenantTable(tenantId, 'documents')
        .where({ document_id: documentId }).select('updated_at', 'edited_by').first();
      const bundles = await import('@alga-psa/authorization/bundles/service');
      const rulesSpy = vi.spyOn(bundles, 'resolveBundleNarrowingRulesForEvaluation').mockResolvedValue([
        { id: 'redact-content', resource: 'document', action: 'read', constraintKey: 'hide_content', redactedFields: ['content'] },
      ] as any);
      try {
        const room = `document:${tenantId}:${documentId}`;
        const denied = connect(room);
        let closed = false;
        denied.provider.on('close', () => { closed = true; });
        await expect.poll(() => closed, { timeout: 5000 }).toBe(true);
        expect(denied.document.getXmlFragment('prosemirror').length).toBe(0);

        const replacement = new Y.Doc(); documents.add(replacement);
        write(replacement, 'redacted overwrite');
        const update = Buffer.from(Y.encodeStateAsUpdate(replacement)).toString('base64');
        const credential = signDocumentRoomToken({ tenantId, documentId, userId });
        const response = await fetch(apiUrl, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.COLLAB_PERSIST_API_KEY! },
          body: JSON.stringify({ tenantId, documentId, update, credential }),
        });
        expect(response.status).toBe(403);
        expect(await tenantTable(tenantId, 'document_block_content').where({ document_id: documentId }).first())
          .toMatchObject({ block_data: storedBefore.block_data, updated_at: storedBefore.updated_at });
        expect(await tenantTable(tenantId, 'documents').where({ document_id: documentId })
          .select('updated_at', 'edited_by').first()).toEqual(metadataBefore);
      } finally {
        rulesSpy.mockRestore();
      }
    });
  });
});
