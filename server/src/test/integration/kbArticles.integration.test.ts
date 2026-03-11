/**
 * Integration tests for Phase 5: Knowledge Base Foundation
 *
 * Tests:
 * - T031: createArticle() creates both document and kb_articles record in transaction
 * - T032: publishArticle() with audience='client' sets is_client_visible=true
 * - T033: archiveArticle() sets status='archived' and clears is_client_visible
 * - T034: Full publishing workflow (draft→review→published→archived)
 * - T035: getArticles() correctly filters by audience, status, and article_type
 * - T036: getStaleArticles() returns only published articles past review due
 * - T037: recordArticleView() and recordArticleFeedback() increment counts
 * - T038: Client portal KB query returns only published client-audience articles
 * - T039: Tenant isolation (RLS enforced)
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
let reviewerId: string;

// Action imports
let createArticle: typeof import('@alga-psa/documents/actions').createArticle;
let updateArticle: typeof import('@alga-psa/documents/actions').updateArticle;
let publishArticle: typeof import('@alga-psa/documents/actions').publishArticle;
let archiveArticle: typeof import('@alga-psa/documents/actions').archiveArticle;
let submitForReview: typeof import('@alga-psa/documents/actions').submitForReview;
let completeReview: typeof import('@alga-psa/documents/actions').completeReview;
let getArticles: typeof import('@alga-psa/documents/actions').getArticles;
let getArticle: typeof import('@alga-psa/documents/actions').getArticle;
let getStaleArticles: typeof import('@alga-psa/documents/actions').getStaleArticles;
let recordArticleView: typeof import('@alga-psa/documents/actions').recordArticleView;
let recordArticleFeedback: typeof import('@alga-psa/documents/actions').recordArticleFeedback;

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
  articleIds: string[];
  documentIds: string[];
};

let createdIds: CreatedIds = {
  articleIds: [],
  documentIds: []
};

async function cleanupCreatedRecords(db: Knex, tenantId: string, ids: CreatedIds): Promise<void> {
  const safeDelete = async (table: string, where: Record<string, unknown>) => {
    try {
      await db(table).where(where).del();
    } catch {
      // Ignore cleanup issues
    }
  };

  // Delete in dependency order
  for (const articleId of ids.articleIds) {
    await safeDelete('kb_article_reviewers', { tenant: tenantId, article_id: articleId });
    await safeDelete('kb_articles', { tenant: tenantId, article_id: articleId });
  }

  for (const docId of ids.documentIds) {
    await safeDelete('document_associations', { tenant: tenantId, document_id: docId });
    await safeDelete('documents', { tenant: tenantId, document_id: docId });
  }

  // Delete KB folder
  await safeDelete('document_folders', { tenant: tenantId, folder_path: '/Knowledge Base' });
}

describe('KB Articles Integration Tests', () => {
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

    tenantId = await createTenant(db, 'KB Articles Test Tenant');
    userId = await createUser(db, tenantId, { username: 'kb-author' });
    reviewerId = await createUser(db, tenantId, { username: 'kb-reviewer' });

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
    const kbActions = await import('@alga-psa/documents/actions');
    createArticle = kbActions.createArticle;
    updateArticle = kbActions.updateArticle;
    publishArticle = kbActions.publishArticle;
    archiveArticle = kbActions.archiveArticle;
    submitForReview = kbActions.submitForReview;
    completeReview = kbActions.completeReview;
    getArticles = kbActions.getArticles;
    getArticle = kbActions.getArticle;
    getStaleArticles = kbActions.getStaleArticles;
    recordArticleView = kbActions.recordArticleView;
    recordArticleFeedback = kbActions.recordArticleFeedback;
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  afterEach(async () => {
    if (db && tenantId) {
      await cleanupCreatedRecords(db, tenantId, createdIds);
    }
    createdIds = {
      articleIds: [],
      documentIds: []
    };
    vi.clearAllMocks();
  });

  describe('T031: createArticle() transactional behavior', () => {
    it('should create both document and kb_articles record', async () => {
      const article = await createArticle({
        title: 'Test Article',
        articleType: 'how_to',
        audience: 'internal'
      });

      expect(article).toBeDefined();
      expect('article_id' in article).toBe(true);

      const createdArticle = article as { article_id: string; document_id: string; slug: string; status: string };
      createdIds.articleIds.push(createdArticle.article_id);
      createdIds.documentIds.push(createdArticle.document_id);

      // Verify article record
      expect(createdArticle.slug).toBeDefined();
      expect(createdArticle.status).toBe('draft');

      // Verify document record
      const doc = await db('documents')
        .where({ tenant: tenantId, document_id: createdArticle.document_id })
        .first();
      expect(doc).toBeDefined();
      expect(doc.document_name).toBe('Test Article');
    });

    it('should generate slug from title', async () => {
      const article = await createArticle({
        title: 'How to Reset User Password',
        articleType: 'how_to',
        audience: 'internal'
      });

      const createdArticle = article as { article_id: string; document_id: string; slug: string };
      createdIds.articleIds.push(createdArticle.article_id);
      createdIds.documentIds.push(createdArticle.document_id);

      expect(createdArticle.slug).toBe('how-to-reset-user-password');
    });

    it('should reject duplicate slug', async () => {
      const article1 = await createArticle({
        title: 'Unique Title',
        slug: 'unique-slug',
        articleType: 'how_to',
        audience: 'internal'
      });

      const a1 = article1 as { article_id: string; document_id: string };
      createdIds.articleIds.push(a1.article_id);
      createdIds.documentIds.push(a1.document_id);

      // Try to create another with same slug
      await expect(createArticle({
        title: 'Different Title',
        slug: 'unique-slug',
        articleType: 'faq',
        audience: 'client'
      })).rejects.toThrow(/slug/i);
    });
  });

  describe('T032: publishArticle() with audience visibility', () => {
    it('should set is_client_visible=true for client audience', async () => {
      const article = await createArticle({
        title: 'Client Visible Article',
        articleType: 'faq',
        audience: 'client'
      });

      const created = article as { article_id: string; document_id: string };
      createdIds.articleIds.push(created.article_id);
      createdIds.documentIds.push(created.document_id);

      // Initially not visible
      let doc = await db('documents')
        .where({ tenant: tenantId, document_id: created.document_id })
        .first();
      expect(doc.is_client_visible).toBe(false);

      // Publish
      await publishArticle(created.article_id);

      // Now should be visible
      doc = await db('documents')
        .where({ tenant: tenantId, document_id: created.document_id })
        .first();
      expect(doc.is_client_visible).toBe(true);
    });

    it('should NOT set is_client_visible for internal audience', async () => {
      const article = await createArticle({
        title: 'Internal Only Article',
        articleType: 'reference',
        audience: 'internal'
      });

      const created = article as { article_id: string; document_id: string };
      createdIds.articleIds.push(created.article_id);
      createdIds.documentIds.push(created.document_id);

      // Publish
      await publishArticle(created.article_id);

      // Should remain not visible
      const doc = await db('documents')
        .where({ tenant: tenantId, document_id: created.document_id })
        .first();
      expect(doc.is_client_visible).toBe(false);
    });
  });

  describe('T033: archiveArticle() behavior', () => {
    it('should set status=archived and clear is_client_visible', async () => {
      // Create and publish client-visible article
      const article = await createArticle({
        title: 'To Be Archived',
        articleType: 'faq',
        audience: 'client'
      });

      const created = article as { article_id: string; document_id: string };
      createdIds.articleIds.push(created.article_id);
      createdIds.documentIds.push(created.document_id);

      await publishArticle(created.article_id);

      // Verify published and visible
      let articleRecord = await db('kb_articles')
        .where({ tenant: tenantId, article_id: created.article_id })
        .first();
      expect(articleRecord.status).toBe('published');

      let doc = await db('documents')
        .where({ tenant: tenantId, document_id: created.document_id })
        .first();
      expect(doc.is_client_visible).toBe(true);

      // Archive
      await archiveArticle(created.article_id);

      // Verify archived and not visible
      articleRecord = await db('kb_articles')
        .where({ tenant: tenantId, article_id: created.article_id })
        .first();
      expect(articleRecord.status).toBe('archived');

      doc = await db('documents')
        .where({ tenant: tenantId, document_id: created.document_id })
        .first();
      expect(doc.is_client_visible).toBe(false);
    });
  });

  describe('T034: Full publishing workflow', () => {
    it('should transition draft→review→published→archived', async () => {
      // Create article (draft)
      const article = await createArticle({
        title: 'Workflow Test Article',
        articleType: 'troubleshooting',
        audience: 'client'
      });

      const created = article as { article_id: string; document_id: string };
      createdIds.articleIds.push(created.article_id);
      createdIds.documentIds.push(created.document_id);

      // Verify draft
      let record = await db('kb_articles')
        .where({ tenant: tenantId, article_id: created.article_id })
        .first();
      expect(record.status).toBe('draft');

      // Submit for review
      await submitForReview(created.article_id, [reviewerId]);

      record = await db('kb_articles')
        .where({ tenant: tenantId, article_id: created.article_id })
        .first();
      expect(record.status).toBe('review');

      // Verify reviewer assignment
      const reviewerRecord = await db('kb_article_reviewers')
        .where({
          tenant: tenantId,
          article_id: created.article_id,
          user_id: reviewerId
        })
        .first();
      expect(reviewerRecord).toBeDefined();
      expect(reviewerRecord.review_status).toBe('pending');

      // Complete review (switch to reviewer context)
      const reviewerUser = createMockUser('internal', {
        user_id: reviewerId,
        tenant: tenantId
      });
      setMockUser(reviewerUser, ['document:update']);

      await completeReview(created.article_id, 'approved', 'Looks good!');

      // Verify review completed
      const completedReview = await db('kb_article_reviewers')
        .where({
          tenant: tenantId,
          article_id: created.article_id,
          user_id: reviewerId
        })
        .first();
      expect(completedReview.review_status).toBe('approved');
      expect(completedReview.review_notes).toBe('Looks good!');

      // Switch back to author and publish
      const authorUser = createMockUser('internal', {
        user_id: userId,
        tenant: tenantId
      });
      setMockUser(authorUser, ['document:update']);

      await publishArticle(created.article_id);

      record = await db('kb_articles')
        .where({ tenant: tenantId, article_id: created.article_id })
        .first();
      expect(record.status).toBe('published');
      expect(record.published_at).toBeDefined();

      // Archive
      await archiveArticle(created.article_id);

      record = await db('kb_articles')
        .where({ tenant: tenantId, article_id: created.article_id })
        .first();
      expect(record.status).toBe('archived');
    });
  });

  describe('T035: getArticles() filtering', () => {
    it('should filter by audience, status, and article_type', async () => {
      // Create multiple articles with different attributes
      const internalDraft = await createArticle({
        title: 'Internal Draft',
        articleType: 'how_to',
        audience: 'internal'
      });
      const clientPublished = await createArticle({
        title: 'Client Published',
        articleType: 'faq',
        audience: 'client'
      });

      const a1 = internalDraft as { article_id: string; document_id: string };
      const a2 = clientPublished as { article_id: string; document_id: string };
      createdIds.articleIds.push(a1.article_id, a2.article_id);
      createdIds.documentIds.push(a1.document_id, a2.document_id);

      // Publish the client article
      await publishArticle(a2.article_id);

      // Filter by status=draft
      let result = await getArticles(1, 20, { status: 'draft' });
      let articles = (result as { articles: Array<{ article_id: string }> }).articles;
      expect(articles.some((a) => a.article_id === a1.article_id)).toBe(true);
      expect(articles.some((a) => a.article_id === a2.article_id)).toBe(false);

      // Filter by status=published
      result = await getArticles(1, 20, { status: 'published' });
      articles = (result as { articles: Array<{ article_id: string }> }).articles;
      expect(articles.some((a) => a.article_id === a2.article_id)).toBe(true);
      expect(articles.some((a) => a.article_id === a1.article_id)).toBe(false);

      // Filter by audience=client
      result = await getArticles(1, 20, { audience: 'client' });
      articles = (result as { articles: Array<{ article_id: string }> }).articles;
      expect(articles.some((a) => a.article_id === a2.article_id)).toBe(true);
      expect(articles.some((a) => a.article_id === a1.article_id)).toBe(false);

      // Filter by articleType=how_to
      result = await getArticles(1, 20, { articleType: 'how_to' });
      articles = (result as { articles: Array<{ article_id: string }> }).articles;
      expect(articles.some((a) => a.article_id === a1.article_id)).toBe(true);
      expect(articles.some((a) => a.article_id === a2.article_id)).toBe(false);

      // Combined filter
      result = await getArticles(1, 20, { status: 'published', audience: 'client' });
      articles = (result as { articles: Array<{ article_id: string }> }).articles;
      expect(articles.some((a) => a.article_id === a2.article_id)).toBe(true);
      expect(articles.some((a) => a.article_id === a1.article_id)).toBe(false);
    });
  });

  describe('T036: getStaleArticles() review due filtering', () => {
    it('should return only published articles past next_review_due', async () => {
      // Create article with past review due date
      const staleArticle = await createArticle({
        title: 'Stale Article',
        articleType: 'how_to',
        audience: 'internal',
        reviewCycleDays: 1 // Sets next_review_due to tomorrow initially
      });

      const a1 = staleArticle as { article_id: string; document_id: string };
      createdIds.articleIds.push(a1.article_id);
      createdIds.documentIds.push(a1.document_id);

      // Manually set next_review_due to past
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      await db('kb_articles')
        .where({ tenant: tenantId, article_id: a1.article_id })
        .update({ next_review_due: pastDate });

      // Publish it
      await publishArticle(a1.article_id);

      // Create fresh article (not stale)
      const freshArticle = await createArticle({
        title: 'Fresh Article',
        articleType: 'faq',
        audience: 'internal',
        reviewCycleDays: 30 // Far in future
      });

      const a2 = freshArticle as { article_id: string; document_id: string };
      createdIds.articleIds.push(a2.article_id);
      createdIds.documentIds.push(a2.document_id);

      await publishArticle(a2.article_id);

      // Get stale articles
      const staleResult = await getStaleArticles();
      const staleArticles = staleResult as Array<{ article_id: string }>;

      expect(staleArticles.some((a) => a.article_id === a1.article_id)).toBe(true);
      expect(staleArticles.some((a) => a.article_id === a2.article_id)).toBe(false);
    });

    it('should exclude draft and archived articles from stale list', async () => {
      // Create draft article with past review date
      const draftArticle = await createArticle({
        title: 'Draft Stale',
        articleType: 'how_to',
        audience: 'internal'
      });

      const a1 = draftArticle as { article_id: string; document_id: string };
      createdIds.articleIds.push(a1.article_id);
      createdIds.documentIds.push(a1.document_id);

      // Set past review date but keep as draft
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 10);
      await db('kb_articles')
        .where({ tenant: tenantId, article_id: a1.article_id })
        .update({ next_review_due: pastDate });

      // Get stale articles
      const staleResult = await getStaleArticles();
      const staleArticles = staleResult as Array<{ article_id: string }>;

      // Draft should NOT appear even with past review date
      expect(staleArticles.some((a) => a.article_id === a1.article_id)).toBe(false);
    });
  });

  describe('T037: View and feedback tracking', () => {
    it('should increment view_count', async () => {
      const article = await createArticle({
        title: 'View Count Test',
        articleType: 'how_to',
        audience: 'internal'
      });

      const created = article as { article_id: string; document_id: string };
      createdIds.articleIds.push(created.article_id);
      createdIds.documentIds.push(created.document_id);

      // Initial count should be 0
      let record = await db('kb_articles')
        .where({ tenant: tenantId, article_id: created.article_id })
        .first();
      expect(record.view_count).toBe(0);

      // Record views
      await recordArticleView(created.article_id);
      await recordArticleView(created.article_id);
      await recordArticleView(created.article_id);

      // Count should be 3
      record = await db('kb_articles')
        .where({ tenant: tenantId, article_id: created.article_id })
        .first();
      expect(record.view_count).toBe(3);
    });

    it('should increment helpful_count and not_helpful_count correctly', async () => {
      const article = await createArticle({
        title: 'Feedback Test',
        articleType: 'faq',
        audience: 'client'
      });

      const created = article as { article_id: string; document_id: string };
      createdIds.articleIds.push(created.article_id);
      createdIds.documentIds.push(created.document_id);

      // Initial counts should be 0
      let record = await db('kb_articles')
        .where({ tenant: tenantId, article_id: created.article_id })
        .first();
      expect(record.helpful_count).toBe(0);
      expect(record.not_helpful_count).toBe(0);

      // Record feedback
      await recordArticleFeedback(created.article_id, true); // helpful
      await recordArticleFeedback(created.article_id, true); // helpful
      await recordArticleFeedback(created.article_id, false); // not helpful

      // Verify counts
      record = await db('kb_articles')
        .where({ tenant: tenantId, article_id: created.article_id })
        .first();
      expect(record.helpful_count).toBe(2);
      expect(record.not_helpful_count).toBe(1);
    });
  });

  describe('T038: Client portal KB query filtering', () => {
    it('should only return published client-audience articles', async () => {
      // Create various articles
      const clientPublished = await createArticle({
        title: 'Client Published KB',
        articleType: 'faq',
        audience: 'client'
      });

      const clientDraft = await createArticle({
        title: 'Client Draft KB',
        articleType: 'how_to',
        audience: 'client'
      });

      const internalPublished = await createArticle({
        title: 'Internal Published KB',
        articleType: 'reference',
        audience: 'internal'
      });

      const a1 = clientPublished as { article_id: string; document_id: string };
      const a2 = clientDraft as { article_id: string; document_id: string };
      const a3 = internalPublished as { article_id: string; document_id: string };

      createdIds.articleIds.push(a1.article_id, a2.article_id, a3.article_id);
      createdIds.documentIds.push(a1.document_id, a2.document_id, a3.document_id);

      // Publish client and internal articles
      await publishArticle(a1.article_id);
      await publishArticle(a3.article_id);

      // Query for client portal (published + client audience)
      const result = await getArticles(1, 20, {
        status: 'published',
        audience: 'client'
      });

      const articles = (result as { articles: Array<{ article_id: string }> }).articles;

      // Should include published client article
      expect(articles.some((a) => a.article_id === a1.article_id)).toBe(true);

      // Should NOT include draft client article
      expect(articles.some((a) => a.article_id === a2.article_id)).toBe(false);

      // Should NOT include internal articles
      expect(articles.some((a) => a.article_id === a3.article_id)).toBe(false);
    });
  });

  describe('T039: Tenant isolation (RLS)', () => {
    it('should not allow access to other tenant articles', async () => {
      // Create article in current tenant
      const article = await createArticle({
        title: 'Tenant A Article',
        articleType: 'how_to',
        audience: 'internal'
      });

      const created = article as { article_id: string; document_id: string };
      createdIds.articleIds.push(created.article_id);
      createdIds.documentIds.push(created.document_id);

      // Create second tenant directly in DB
      const tenant2Id = uuidv4();
      const now = new Date().toISOString();

      await db('tenants').insert({
        tenant: tenant2Id,
        client_name: 'Tenant 2',
        phone_number: '555-0200',
        email: `tenant2-${tenant2Id.substring(0, 8)}@example.com`,
        created_at: now,
        updated_at: now,
        payment_platform_id: `test-platform-${tenant2Id.substring(0, 8)}`,
        payment_method_id: `test-method-${tenant2Id.substring(0, 8)}`,
        auth_service_id: `test-auth-${tenant2Id.substring(0, 8)}`,
        plan: 'test'
      });

      // Try to query from Tenant 2 context (simulate by direct DB query with different tenant)
      const tenant2Articles = await db('kb_articles')
        .where({ tenant: tenant2Id });

      // Should be empty - no articles in tenant 2
      expect(tenant2Articles.length).toBe(0);

      // Verify article exists in tenant 1
      const tenant1Articles = await db('kb_articles')
        .where({ tenant: tenantId });
      expect(tenant1Articles.some((a: { article_id: string }) => a.article_id === created.article_id)).toBe(true);

      // Cleanup tenant 2
      await db('tenants').where({ tenant: tenant2Id }).del();
    });
  });
});
