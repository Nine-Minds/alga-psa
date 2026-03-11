/**
 * Integration tests for Phase 4: Document Share URLs
 *
 * Tests:
 * - T022: createShareLink() generates unique 256-bit token, hashes password
 * - T023: validateShareToken() validates and rejects appropriately
 * - T024: GET /api/share/[token] serves file for valid public share
 * - T025: Password-protected share requires correct password
 * - T026: Portal-authenticated share requires session
 * - T027: Access logging and download count increment
 * - T028: revokeShareLink() soft-revokes and invalidates
 */
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';
import { setupCommonMocks, createMockUser, setMockUser } from '../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let userId: string;

// Action imports
let createShareLink: typeof import('@alga-psa/documents/actions').createShareLink;
let getShareLinksForDocument: typeof import('@alga-psa/documents/actions').getShareLinksForDocument;
let revokeShareLink: typeof import('@alga-psa/documents/actions').revokeShareLink;
let validateShareToken: typeof import('@alga-psa/documents/actions').validateShareToken;
let verifySharePassword: typeof import('@alga-psa/documents/actions').verifySharePassword;
let logShareAccess: typeof import('@alga-psa/documents/actions').logShareAccess;
let incrementDownloadCount: typeof import('@alga-psa/documents/actions').incrementDownloadCount;

// Mock the database module to return test database
vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
    getConnection: vi.fn(async () => db)
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
}));

// Track created resources
type CreatedIds = {
  documentIds: string[];
  shareIds: string[];
};

let createdIds: CreatedIds = {
  documentIds: [],
  shareIds: []
};

async function cleanupCreatedRecords(db: Knex, tenantId: string, ids: CreatedIds): Promise<void> {
  const safeDelete = async (table: string, where: Record<string, unknown>) => {
    try {
      await db(table).where(where).del();
    } catch {
      // Ignore cleanup issues
    }
  };

  // Delete access logs first
  for (const shareId of ids.shareIds) {
    await safeDelete('document_share_access_log', { tenant: tenantId, share_id: shareId });
  }

  // Delete share links
  for (const shareId of ids.shareIds) {
    await safeDelete('document_share_links', { tenant: tenantId, share_id: shareId });
  }

  // Delete documents
  for (const docId of ids.documentIds) {
    await safeDelete('document_associations', { tenant: tenantId, document_id: docId });
    await safeDelete('documents', { tenant: tenantId, document_id: docId });
  }
}

async function createDocument(db: Knex, tenantId: string, userId: string, name: string): Promise<string> {
  const docId = uuidv4();
  const now = new Date();

  await db('documents').insert({
    tenant: tenantId,
    document_id: docId,
    document_name: name,
    content: '',
    created_by: userId,
    created_at: now,
    updated_at: now,
    is_client_visible: false
  });

  return docId;
}

describe('Document Share Links Integration Tests', () => {
  beforeAll(async () => {
    // Set environment
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection();

    tenantId = await createTenant(db, 'Share Links Test Tenant');
    userId = await createUser(db, tenantId, { username: 'share-links-user' });

    // Setup mocks
    const mockUser = createMockUser('internal', {
      user_id: userId,
      tenant: tenantId
    });
    setMockUser(mockUser, ['document:read', 'document:create', 'document:update', 'document:delete']);
    setupCommonMocks({
      tenantId,
      userId,
      user: mockUser,
      permissionCheck: () => true
    });

    // Import actions
    const shareLinkActions = await import('@alga-psa/documents/actions');
    createShareLink = shareLinkActions.createShareLink;
    getShareLinksForDocument = shareLinkActions.getShareLinksForDocument;
    revokeShareLink = shareLinkActions.revokeShareLink;
    validateShareToken = shareLinkActions.validateShareToken;
    verifySharePassword = shareLinkActions.verifySharePassword;
    logShareAccess = shareLinkActions.logShareAccess;
    incrementDownloadCount = shareLinkActions.incrementDownloadCount;
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  afterEach(async () => {
    if (db && tenantId) {
      await cleanupCreatedRecords(db, tenantId, createdIds);
    }
    createdIds = {
      documentIds: [],
      shareIds: []
    };
    vi.clearAllMocks();
  });

  describe('T022: createShareLink() token generation and password hashing', () => {
    it('should generate unique 256-bit token', async () => {
      const docId = await createDocument(db, tenantId, userId, 'Token Test Doc');
      createdIds.documentIds.push(docId);

      const share = await createShareLink({ documentId: docId, shareType: 'public' });

      expect(share).toBeDefined();
      expect('share_id' in share).toBe(true);

      const shareLink = share as { share_id: string; token: string };
      createdIds.shareIds.push(shareLink.share_id);

      // Token should be URL-safe base64 encoded 32 bytes (256 bits)
      // 32 bytes = 43 base64 characters (without padding)
      expect(shareLink.token).toBeDefined();
      expect(shareLink.token.length).toBeGreaterThanOrEqual(40);

      // Verify token is unique (create another share)
      const share2 = await createShareLink({ documentId: docId, shareType: 'public' });
      const shareLink2 = share2 as { share_id: string; token: string };
      createdIds.shareIds.push(shareLink2.share_id);

      expect(shareLink2.token).not.toBe(shareLink.token);
    });

    it('should hash password for password_protected type', async () => {
      const docId = await createDocument(db, tenantId, userId, 'Password Test Doc');
      createdIds.documentIds.push(docId);

      const password = 'SecurePassword123!';
      const share = await createShareLink({
        documentId: docId,
        shareType: 'password',
        password: password
      });

      const shareLink = share as { share_id: string; password_hash: string | null };
      createdIds.shareIds.push(shareLink.share_id);

      // Password hash should exist
      expect(shareLink.password_hash).toBeDefined();
      expect(shareLink.password_hash).not.toBeNull();
      expect(shareLink.password_hash).not.toBe(password); // Should be hashed

      // Hash should be bcrypt format ($2b$...)
      expect(shareLink.password_hash).toMatch(/^\$2[aby]\$/);
    });

    it('should store expiry and max_downloads', async () => {
      const docId = await createDocument(db, tenantId, userId, 'Limits Test Doc');
      createdIds.documentIds.push(docId);

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

      const share = await createShareLink({
        documentId: docId,
        shareType: 'public',
        expiresAt: expiresAt,
        maxDownloads: 10
      });

      const shareLink = share as { share_id: string; expires_at: Date | null; max_downloads: number | null };
      createdIds.shareIds.push(shareLink.share_id);

      expect(shareLink.expires_at).toBeDefined();
      expect(shareLink.max_downloads).toBe(10);
    });
  });

  describe('T023: validateShareToken() validation', () => {
    it('should return document data for valid token', async () => {
      const docId = await createDocument(db, tenantId, userId, 'Valid Token Doc');
      createdIds.documentIds.push(docId);

      const share = await createShareLink({ documentId: docId, shareType: 'public' });
      const shareLink = share as { share_id: string; token: string };
      createdIds.shareIds.push(shareLink.share_id);

      const result = await validateShareToken(shareLink.token);

      expect(result.valid).toBe(true);
      expect(result.share).toBeDefined();
      expect(result.share?.document_id).toBe(docId);
      expect(result.share?.document_name).toBe('Valid Token Doc');
    });

    it('should reject revoked token', async () => {
      const docId = await createDocument(db, tenantId, userId, 'Revoked Token Doc');
      createdIds.documentIds.push(docId);

      const share = await createShareLink({ documentId: docId, shareType: 'public' });
      const shareLink = share as { share_id: string; token: string };
      createdIds.shareIds.push(shareLink.share_id);

      // Revoke the share
      await revokeShareLink(shareLink.share_id);

      const result = await validateShareToken(shareLink.token);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/revoked/i);
    });

    it('should reject expired token', async () => {
      const docId = await createDocument(db, tenantId, userId, 'Expired Token Doc');
      createdIds.documentIds.push(docId);

      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1); // Yesterday

      const share = await createShareLink({
        documentId: docId,
        shareType: 'public',
        expiresAt: pastDate
      });
      const shareLink = share as { share_id: string; token: string };
      createdIds.shareIds.push(shareLink.share_id);

      const result = await validateShareToken(shareLink.token);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/expired/i);
    });

    it('should reject over-limit token', async () => {
      const docId = await createDocument(db, tenantId, userId, 'Over Limit Doc');
      createdIds.documentIds.push(docId);

      const share = await createShareLink({
        documentId: docId,
        shareType: 'public',
        maxDownloads: 2
      });
      const shareLink = share as { share_id: string; token: string };
      createdIds.shareIds.push(shareLink.share_id);

      // Increment download count to max
      await incrementDownloadCount(shareLink.token);
      await incrementDownloadCount(shareLink.token);

      const result = await validateShareToken(shareLink.token);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/limit/i);
    });

    it('should return error for invalid token', async () => {
      const result = await validateShareToken('invalid-token-12345');

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid/i);
    });
  });

  describe('T024: Public share access', () => {
    it('should allow access to valid public share without authentication', async () => {
      const docId = await createDocument(db, tenantId, userId, 'Public Access Doc');
      createdIds.documentIds.push(docId);

      const share = await createShareLink({ documentId: docId, shareType: 'public' });
      const shareLink = share as { share_id: string; token: string };
      createdIds.shareIds.push(shareLink.share_id);

      // Validate without any session context
      const result = await validateShareToken(shareLink.token);

      expect(result.valid).toBe(true);
      expect(result.share?.share_type).toBe('public');
    });
  });

  describe('T025: Password-protected share verification', () => {
    it('should reject wrong password', async () => {
      const docId = await createDocument(db, tenantId, userId, 'Password Protected Doc');
      createdIds.documentIds.push(docId);

      const correctPassword = 'CorrectPassword123!';
      const share = await createShareLink({
        documentId: docId,
        shareType: 'password',
        password: correctPassword
      });
      const shareLink = share as { share_id: string; token: string };
      createdIds.shareIds.push(shareLink.share_id);

      const isValid = await verifySharePassword(shareLink.token, 'WrongPassword');

      expect(isValid).toBe(false);
    });

    it('should accept correct password', async () => {
      const docId = await createDocument(db, tenantId, userId, 'Correct Password Doc');
      createdIds.documentIds.push(docId);

      const correctPassword = 'SecretPass456!';
      const share = await createShareLink({
        documentId: docId,
        shareType: 'password',
        password: correctPassword
      });
      const shareLink = share as { share_id: string; token: string };
      createdIds.shareIds.push(shareLink.share_id);

      const isValid = await verifySharePassword(shareLink.token, correctPassword);

      expect(isValid).toBe(true);
    });
  });

  describe('T026: Portal-authenticated share', () => {
    it('should create portal_authenticated share type', async () => {
      const docId = await createDocument(db, tenantId, userId, 'Portal Auth Doc');
      createdIds.documentIds.push(docId);

      const share = await createShareLink({
        documentId: docId,
        shareType: 'portal_authenticated'
      });
      const shareLink = share as { share_id: string; token: string; share_type: string };
      createdIds.shareIds.push(shareLink.share_id);

      expect(shareLink.share_type).toBe('portal_authenticated');

      // Validation should return the share but access check happens at route level
      const result = await validateShareToken(shareLink.token);
      expect(result.valid).toBe(true);
      expect(result.share?.share_type).toBe('portal_authenticated');
    });
  });

  describe('T027: Access logging and download count', () => {
    it('should log access with IP and user agent', async () => {
      const docId = await createDocument(db, tenantId, userId, 'Access Log Doc');
      createdIds.documentIds.push(docId);

      const share = await createShareLink({ documentId: docId, shareType: 'public' });
      const shareLink = share as { share_id: string; token: string };
      createdIds.shareIds.push(shareLink.share_id);

      // Log access
      await logShareAccess(shareLink.share_id, tenantId, {
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0 Test Browser',
        accessType: 'download',
        wasSuccessful: true
      });

      // Verify log entry
      const logEntry = await db('document_share_access_log')
        .where({
          tenant: tenantId,
          share_id: shareLink.share_id
        })
        .first();

      expect(logEntry).toBeDefined();
      expect(logEntry.ip_address).toBe('192.168.1.1');
      expect(logEntry.user_agent).toBe('Mozilla/5.0 Test Browser');
      expect(logEntry.access_type).toBe('download');
      expect(logEntry.was_successful).toBe(true);
    });

    it('should increment download count on each access', async () => {
      const docId = await createDocument(db, tenantId, userId, 'Download Count Doc');
      createdIds.documentIds.push(docId);

      const share = await createShareLink({ documentId: docId, shareType: 'public' });
      const shareLink = share as { share_id: string; token: string };
      createdIds.shareIds.push(shareLink.share_id);

      // Initial count should be 0
      let shareRecord = await db('document_share_links')
        .where({ tenant: tenantId, share_id: shareLink.share_id })
        .first();
      expect(shareRecord.download_count).toBe(0);

      // Increment
      await incrementDownloadCount(shareLink.token);
      await incrementDownloadCount(shareLink.token);
      await incrementDownloadCount(shareLink.token);

      // Count should be 3
      shareRecord = await db('document_share_links')
        .where({ tenant: tenantId, share_id: shareLink.share_id })
        .first();
      expect(shareRecord.download_count).toBe(3);
    });
  });

  describe('T028: revokeShareLink() behavior', () => {
    it('should soft-revoke link and invalidate subsequent access', async () => {
      const docId = await createDocument(db, tenantId, userId, 'Revoke Test Doc');
      createdIds.documentIds.push(docId);

      const share = await createShareLink({ documentId: docId, shareType: 'public' });
      const shareLink = share as { share_id: string; token: string };
      createdIds.shareIds.push(shareLink.share_id);

      // Verify it's valid initially
      let result = await validateShareToken(shareLink.token);
      expect(result.valid).toBe(true);

      // Revoke
      const revoked = await revokeShareLink(shareLink.share_id);
      expect(revoked).toBe(true);

      // Verify revocation metadata
      const revokedRecord = await db('document_share_links')
        .where({ tenant: tenantId, share_id: shareLink.share_id })
        .first();
      expect(revokedRecord.is_revoked).toBe(true);
      expect(revokedRecord.revoked_at).toBeDefined();
      expect(revokedRecord.revoked_by).toBe(userId);

      // Verify subsequent validation fails
      result = await validateShareToken(shareLink.token);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/revoked/i);
    });

    it('should not appear in getShareLinksForDocument after revocation', async () => {
      const docId = await createDocument(db, tenantId, userId, 'List Revoke Doc');
      createdIds.documentIds.push(docId);

      const share = await createShareLink({ documentId: docId, shareType: 'public' });
      const shareLink = share as { share_id: string; token: string };
      createdIds.shareIds.push(shareLink.share_id);

      // Should appear in list
      let links = await getShareLinksForDocument(docId);
      expect(Array.isArray(links)).toBe(true);
      expect((links as Array<{ share_id: string }>).length).toBe(1);

      // Revoke
      await revokeShareLink(shareLink.share_id);

      // Should NOT appear in active links list
      links = await getShareLinksForDocument(docId);
      expect(Array.isArray(links)).toBe(true);
      expect((links as Array<{ share_id: string }>).length).toBe(0);
    });
  });
});
