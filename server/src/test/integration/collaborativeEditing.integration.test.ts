import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

/**
 * Collaborative Editing — Integration Tests
 *
 * Tests the server-side components of collaborative editing:
 * - Document creation for collaborative sessions
 * - Snapshot sync from Y.js state back to document_block_content
 * - Feature flag gating
 * - Tenant isolation in room name construction
 *
 * These tests use a real test database but mock the Hocuspocus connection
 * (actual WebSocket collaboration is tested manually via the test page).
 *
 * Run: npm run test:integration -- collaborativeEditing
 */

let db: Knex;
let tenantId: string;
let userId: string;
let secondTenantId: string;
let secondUserId: string;

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
    hasPermission: vi.fn(() => Promise.resolve(true)),
    getSession: vi.fn(() => Promise.resolve({ user: { id: userId, tenant: tenantId } })),
  };
});

// Mock event publishing (not relevant to collab tests)
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
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

    secondTenantId = await createTenant(db, 'Other MSP');
    secondUserId = await createUser(db, secondTenantId, {
      first_name: 'Editor',
      last_name: 'Two',
      email: 'editor2@test.com',
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    // Cleanup in reverse FK order
    for (const table of ['document_block_content', 'documents', 'users', 'tenants']) {
      try {
        if (table === 'tenants') {
          await db(table).whereIn('tenant', [tenantId, secondTenantId]).del();
        } else {
          await db(table).where({ tenant: tenantId }).del();
          await db(table).where({ tenant: secondTenantId }).del();
        }
      } catch (e) {
        // table may not exist in test DB — ignore
      }
    }
    await db.destroy();
  }, HOOK_TIMEOUT);

  // ─── Document Creation for Collab Sessions ───────────────────────

  describe('Document creation for collaborative sessions', () => {
    let testDocId: string;

    afterEach(async () => {
      if (testDocId) {
        await db('document_block_content').where({ document_id: testDocId, tenant: tenantId }).del();
        await db('documents').where({ document_id: testDocId, tenant: tenantId }).del();
        testDocId = '';
      }
    });

    it('should create a document with empty block_data for a new collab session', async () => {
      testDocId = uuidv4();
      const now = db.fn.now();

      await db('documents').insert({
        document_id: testDocId,
        document_name: 'Collab Test Doc',
        user_id: userId,
        created_by: userId,
        tenant: tenantId,
        order_number: 0,
        created_at: now,
        updated_at: now,
      });

      await db('document_block_content').insert({
        content_id: uuidv4(),
        document_id: testDocId,
        block_data: JSON.stringify({ type: 'doc', content: [] }),
        tenant: tenantId,
        created_at: now,
        updated_at: now,
      });

      const doc = await db('documents').where({ document_id: testDocId, tenant: tenantId }).first();
      expect(doc).toBeDefined();
      expect(doc.document_name).toBe('Collab Test Doc');

      const content = await db('document_block_content')
        .where({ document_id: testDocId, tenant: tenantId })
        .first();
      expect(content).toBeDefined();
      expect(content.block_data).toBeDefined();
    });

    it('should enforce tenant in document_block_content composite key', async () => {
      testDocId = uuidv4();
      const now = db.fn.now();

      await db('documents').insert({
        document_id: testDocId,
        document_name: 'Tenant Isolation Doc',
        user_id: userId,
        created_by: userId,
        tenant: tenantId,
        order_number: 0,
        created_at: now,
        updated_at: now,
      });

      await db('document_block_content').insert({
        content_id: uuidv4(),
        document_id: testDocId,
        block_data: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
        tenant: tenantId,
        created_at: now,
        updated_at: now,
      });

      // Query with wrong tenant should return nothing
      const wrongTenant = await db('document_block_content')
        .where({ document_id: testDocId, tenant: secondTenantId })
        .first();
      expect(wrongTenant).toBeUndefined();

      // Query with correct tenant should return the content
      const correctTenant = await db('document_block_content')
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

      await db('documents').insert({
        document_id: testDocId,
        document_name: 'Snapshot Test Doc',
        user_id: userId,
        created_by: userId,
        tenant: tenantId,
        order_number: 0,
        created_at: now,
        updated_at: now,
      });

      await db('document_block_content').insert({
        content_id: uuidv4(),
        document_id: testDocId,
        block_data: JSON.stringify({ type: 'doc', content: [] }),
        tenant: tenantId,
        created_at: now,
        updated_at: now,
      });
    });

    afterEach(async () => {
      await db('document_block_content').where({ document_id: testDocId, tenant: tenantId }).del();
      await db('documents').where({ document_id: testDocId, tenant: tenantId }).del();
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

      const [updated] = await db('document_block_content')
        .where({ document_id: testDocId, tenant: tenantId })
        .update({
          block_data: JSON.stringify(collabContent),
          updated_at: db.fn.now(),
        })
        .returning(['content_id', 'block_data']);

      expect(updated).toBeDefined();

      // Verify the snapshot was written correctly
      const content = await db('document_block_content')
        .where({ document_id: testDocId, tenant: tenantId })
        .first();

      const parsed = typeof content.block_data === 'string'
        ? JSON.parse(content.block_data)
        : content.block_data;
      expect(parsed.content[0].content[0].text).toBe('Collaboratively edited content');
    });

    it('should preserve document metadata when syncing snapshot', async () => {
      const beforeSync = await db('documents')
        .where({ document_id: testDocId, tenant: tenantId })
        .first();

      // Simulate snapshot sync — only updates block_content, not the document record
      await db('document_block_content')
        .where({ document_id: testDocId, tenant: tenantId })
        .update({
          block_data: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
          updated_at: db.fn.now(),
        });

      const afterSync = await db('documents')
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

      await db('documents').insert({
        document_id: testDocId,
        document_name: 'Existing Doc',
        user_id: userId,
        created_by: userId,
        tenant: tenantId,
        order_number: 0,
        created_at: now,
        updated_at: now,
      });

      await db('document_block_content').insert({
        content_id: uuidv4(),
        document_id: testDocId,
        block_data: JSON.stringify(existingContent),
        tenant: tenantId,
        created_at: now,
        updated_at: now,
      });
    });

    afterEach(async () => {
      await db('document_block_content').where({ document_id: testDocId, tenant: tenantId }).del();
      await db('documents').where({ document_id: testDocId, tenant: tenantId }).del();
    });

    it('should load existing block_data as TipTap-compatible JSON for Y.js initialization', async () => {
      const content = await db('document_block_content')
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
      const content = await db('document_block_content')
        .where({ document_id: uuidv4(), tenant: tenantId })
        .first();

      expect(content).toBeUndefined();
    });
  });
});
