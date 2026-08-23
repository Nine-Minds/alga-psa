'use server';

import { randomUUID } from 'crypto';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { enqueueImmediateJob } from '@alga-psa/core';
import {
  KB_IMPORT_ALLOWED_EXTENSIONS,
  KB_IMPORT_MAX_FILES,
  KB_IMPORT_MAX_FILE_BYTES,
  KB_IMPORT_MAX_TOTAL_BYTES,
} from '../lib/kbImportLimits';
import {
  KB_ARTICLE_SELECT_COLUMNS,
  createKbArticle,
  generateKbArticleSlug as generateSlug,
  publishKbArticleCreated,
} from '@alga-psa/shared/models/kbArticleModel';
import type {
  ArticleAudience,
  ArticleStatus,
  ArticleType,
  IKBArticle,
  IKBArticleReviewer,
  IKBArticleTemplate,
  IKBArticleWithDocument,
  ITag,
  ReviewStatus,
} from '@alga-psa/types';

export type {
  ArticleAudience,
  ArticleStatus,
  ArticleType,
  IKBArticle,
  IKBArticleReviewer,
  IKBArticleTemplate,
  IKBArticleWithDocument,
  ReviewStatus,
} from '@alga-psa/types';

export interface ICreateArticleInput {
  title: string;
  slug?: string;
  articleType?: ArticleType;
  audience?: ArticleAudience;
  categoryId?: string;
  reviewCycleDays?: number;
  content?: any; // BlockNote JSON
}

export interface IUpdateArticleInput {
  title?: string;
  slug?: string;
  articleType?: ArticleType;
  audience?: ArticleAudience;
  categoryId?: string | null;
  reviewCycleDays?: number | null;
  status?: ArticleStatus;
}

export interface IArticleFilters {
  status?: ArticleStatus;
  audience?: ArticleAudience;
  articleType?: ArticleType;
  categoryId?: string;
  search?: string;
  tagIds?: string[];
  tags?: string[];
}

export interface IKBArticleCategory {
  id: string;
  name: string;
}

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string,
  alias?: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(alias ? `${table} as ${alias}` : table);
}

async function publishKbArticleSearchEvent(
  eventType: 'KB_ARTICLE_CREATED' | 'KB_ARTICLE_UPDATED' | 'KB_ARTICLE_DELETED',
  tenant: string,
  articleId: string,
  options: {
    documentId?: string;
    userId?: string;
    changedFields?: string[];
    status?: string;
  },
): Promise<void> {
  try {
    const occurredAt = new Date().toISOString();
    await publishEvent({
      eventType,
      payload: {
        tenantId: tenant,
        occurredAt,
        articleId,
        documentId: options.documentId,
        userId: options.userId,
        changedFields: options.changedFields,
        status: options.status,
      },
    });
  } catch (eventError) {
    console.error(`[kbArticleActions] Failed to publish ${eventType} search event:`, eventError);
  }
}

/**
 * Creates a new KB article with its underlying document.
 * F081: Creates both document and kb_articles record atomically.
 */
export const createArticle = withAuth(
  async (
    user,
    { tenant },
    input: ICreateArticleInput
  ): Promise<IKBArticleWithDocument | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    if (!(await hasPermission(user, 'document', 'create'))) {
      return permissionError('Permission denied', 'documents:errors.permissions.denied');
    }

    const article = await createKbArticle(knex, { tenant, userId: user.user_id }, input);

    // Published after the writes land, never from inside a transaction.
    await publishKbArticleCreated(tenant, article, user.user_id);

    return article;
  }
);

/**
 * Updates KB article metadata (not document content).
 * F082: Updates KB metadata.
 */
export const updateArticle = withAuth(
  async (
    user,
    { tenant },
    articleId: string,
    input: IUpdateArticleInput
  ): Promise<IKBArticle | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    if (!(await hasPermission(user, 'document', 'update'))) {
      return permissionError('Permission denied', 'documents:errors.permissions.denied');
    }

    if (!articleId) {
      throw new Error('articleId is required');
    }

    const article = await withTransaction(knex, async (trx) => {
      const existing = await tenantScopedTable(trx, 'kb_articles', tenant)
        .where({ article_id: articleId })
        .first();

      if (!existing) {
        throw new Error('Article not found');
      }

      const updates: Record<string, any> = {
        updated_at: trx.fn.now(),
        updated_by: user.user_id,
      };

      if (input.title !== undefined) {
        // Also update the document name
        await tenantScopedTable(trx, 'documents', tenant)
          .where({ document_id: existing.document_id })
          .update({
            document_name: input.title.trim(),
            updated_at: trx.fn.now(),
          });
      }

      if (input.slug !== undefined) {
        const newSlug = input.slug.trim();
        const existingSlug = await tenantScopedTable(trx, 'kb_articles', tenant)
          .where({ slug: newSlug })
          .whereNot('article_id', articleId)
          .first();
        if (existingSlug) {
          throw new Error('An article with this slug already exists');
        }
        updates.slug = newSlug;
      }

      if (input.articleType !== undefined) {
        updates.article_type = input.articleType;
      }

      if (input.audience !== undefined) {
        updates.audience = input.audience;
      }

      if (input.categoryId !== undefined) {
        updates.category_id = input.categoryId;
      }

      if (input.reviewCycleDays !== undefined) {
        updates.review_cycle_days = input.reviewCycleDays;
        if (input.reviewCycleDays) {
          updates.next_review_due = new Date(
            Date.now() + input.reviewCycleDays * 24 * 60 * 60 * 1000
          );
        }
      }

      if (input.status !== undefined) {
        updates.status = input.status;
      }

      await tenantScopedTable(trx, 'kb_articles', tenant)
        .where({ article_id: articleId })
        .update(updates);

      const article = await tenantScopedTable(trx, 'kb_articles', tenant)
        .select(KB_ARTICLE_SELECT_COLUMNS)
        .where({ article_id: articleId })
        .first();

      return article as unknown as IKBArticle;
    });

    await publishKbArticleSearchEvent('KB_ARTICLE_UPDATED', tenant, article.article_id, {
      documentId: article.document_id,
      userId: user.user_id,
      changedFields: Object.keys(input),
      status: article.status,
    });
    return article;
  }
);

/**
 * Publishes an article (sets status=published, auto-sets is_client_visible).
 * F083: Sets status=published and auto-sets is_client_visible for client/public audience.
 */
export const publishArticle = withAuth(
  async (
    user,
    { tenant },
    articleId: string
  ): Promise<IKBArticle | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    if (!(await hasPermission(user, 'document', 'update'))) {
      return permissionError('Permission denied', 'documents:errors.permissions.denied');
    }

    if (!articleId) {
      throw new Error('articleId is required');
    }

    const article = await withTransaction(knex, async (trx) => {
      const existing = await tenantScopedTable(trx, 'kb_articles', tenant)
        .where({ article_id: articleId })
        .first();

      if (!existing) {
        throw new Error('Article not found');
      }

      // Update article status
      await tenantScopedTable(trx, 'kb_articles', tenant)
        .where({ article_id: articleId })
        .update({
          status: 'published',
          published_at: trx.fn.now(),
          published_by: user.user_id,
          updated_at: trx.fn.now(),
          updated_by: user.user_id,
        });

      // Auto-set is_client_visible for client/public audience
      if (existing.audience === 'client' || existing.audience === 'public') {
        await tenantScopedTable(trx, 'documents', tenant)
          .where({ document_id: existing.document_id })
          .update({
            is_client_visible: true,
            updated_at: trx.fn.now(),
          });
      }

      const article = await tenantScopedTable(trx, 'kb_articles', tenant)
        .select(KB_ARTICLE_SELECT_COLUMNS)
        .where({ article_id: articleId })
        .first();

      return article as unknown as IKBArticle;
    });

    await publishKbArticleSearchEvent('KB_ARTICLE_UPDATED', tenant, article.article_id, {
      documentId: article.document_id,
      userId: user.user_id,
      changedFields: ['status', 'published_at', 'is_client_visible'],
      status: article.status,
    });
    return article;
  }
);

/**
 * Archives an article (sets status=archived, clears is_client_visible).
 * F084: Sets status=archived and clears is_client_visible.
 */
export const archiveArticle = withAuth(
  async (
    user,
    { tenant },
    articleId: string
  ): Promise<IKBArticle | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    if (!(await hasPermission(user, 'document', 'update'))) {
      return permissionError('Permission denied', 'documents:errors.permissions.denied');
    }

    if (!articleId) {
      throw new Error('articleId is required');
    }

    const article = await withTransaction(knex, async (trx) => {
      const existing = await tenantScopedTable(trx, 'kb_articles', tenant)
        .where({ article_id: articleId })
        .first();

      if (!existing) {
        throw new Error('Article not found');
      }

      // Update article status
      await tenantScopedTable(trx, 'kb_articles', tenant)
        .where({ article_id: articleId })
        .update({
          status: 'archived',
          updated_at: trx.fn.now(),
          updated_by: user.user_id,
        });

      // Clear is_client_visible
      await tenantScopedTable(trx, 'documents', tenant)
        .where({ document_id: existing.document_id })
        .update({
          is_client_visible: false,
          updated_at: trx.fn.now(),
        });

      const article = await tenantScopedTable(trx, 'kb_articles', tenant)
        .select(KB_ARTICLE_SELECT_COLUMNS)
        .where({ article_id: articleId })
        .first();

      return article as unknown as IKBArticle;
    });

    await publishKbArticleSearchEvent('KB_ARTICLE_UPDATED', tenant, article.article_id, {
      documentId: article.document_id,
      userId: user.user_id,
      changedFields: ['status', 'is_client_visible'],
      status: article.status,
    });
    return article;
  }
);

/**
 * Permanently deletes an article and its underlying document.
 * Only allowed for draft or archived articles — published/in-review must be archived first.
 * Cascades remove kb_article_relations and kb_article_reviewers via FK; tag_mappings,
 * document_block_content, and the document itself are removed explicitly.
 */
export const deleteArticle = withAuth(
  async (
    user,
    { tenant },
    articleId: string
  ): Promise<{ success: true } | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    if (!(await hasPermission(user, 'document', 'delete'))) {
      return permissionError('Permission denied', 'documents:errors.permissions.denied');
    }

    if (!articleId) {
      throw new Error('articleId is required');
    }

    const deleted = await withTransaction(knex, async (trx) => {
      const existing = await tenantScopedTable(trx, 'kb_articles', tenant)
        .where({ article_id: articleId })
        .first();

      if (!existing) {
        throw new Error('Article not found');
      }

      if (existing.status !== 'draft' && existing.status !== 'archived') {
        throw new Error('Only draft or archived articles can be deleted. Archive the article first.');
      }

      await tenantScopedTable(trx, 'tag_mappings', tenant)
        .where({ tagged_id: articleId, tagged_type: 'knowledge_base_article' })
        .del();

      await tenantScopedTable(trx, 'kb_articles', tenant)
        .where({ article_id: articleId })
        .del();

      await tenantScopedTable(trx, 'document_block_content', tenant)
        .where({ document_id: existing.document_id })
        .del();

      await tenantScopedTable(trx, 'documents', tenant)
        .where({ document_id: existing.document_id })
        .del();

      return {
        success: true as const,
        documentId: existing.document_id as string,
      };
    });

    await publishKbArticleSearchEvent('KB_ARTICLE_DELETED', tenant, articleId, {
      documentId: deleted.documentId,
      userId: user.user_id,
    });
    return { success: true };
  }
);

/**
 * Submits an article for review.
 * F085: Creates reviewer assignments.
 */
export const submitForReview = withAuth(
  async (
    user,
    { tenant },
    articleId: string,
    reviewerUserIds: string[]
  ): Promise<boolean | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    if (!(await hasPermission(user, 'document', 'update'))) {
      return permissionError('Permission denied', 'documents:errors.permissions.denied');
    }

    if (!articleId) {
      throw new Error('articleId is required');
    }

    if (!reviewerUserIds?.length) {
      throw new Error('At least one reviewer is required');
    }

    const existing = await tenantScopedTable(knex, 'kb_articles', tenant)
      .where({ article_id: articleId })
      .first();

    if (!existing) {
      throw new Error('Article not found');
    }

    // Update article status to review
    await tenantScopedTable(knex, 'kb_articles', tenant)
      .where({ article_id: articleId })
      .update({
        status: 'review',
        updated_at: knex.fn.now(),
        updated_by: user.user_id,
      });

    // Validate all reviewer user IDs belong to this tenant
    const validUsers = await tenantScopedTable(knex, 'users', tenant)
      .select('user_id')
      .whereIn('user_id', reviewerUserIds);
    const validUserIds = new Set(validUsers.map((u: { user_id: string }) => u.user_id));
    const invalidIds = reviewerUserIds.filter((id) => !validUserIds.has(id));
    if (invalidIds.length > 0) {
      throw new Error(`Invalid reviewer user IDs: ${invalidIds.join(', ')}`);
    }

    // Create reviewer assignments (remove existing pending ones first)
    await tenantScopedTable(knex, 'kb_article_reviewers', tenant)
      .where({ article_id: articleId, review_status: 'pending' })
      .del();

    const reviewerRecords = reviewerUserIds.map((userId) => ({
      tenant,
      reviewer_id: randomUUID(),
      article_id: articleId,
      user_id: userId,
      review_status: 'pending',
      assigned_by: user.user_id,
    }));

    await tenantScopedTable(knex, 'kb_article_reviewers', tenant).insert(reviewerRecords);

    return true;
  }
);

/**
 * Records a reviewer's decision.
 * F086: Records reviewer decision.
 */
export const completeReview = withAuth(
  async (
    user,
    { tenant },
    articleId: string,
    status: ReviewStatus,
    notes?: string
  ): Promise<boolean | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    if (!(await hasPermission(user, 'document', 'update'))) {
      return permissionError('Permission denied', 'documents:errors.permissions.denied');
    }

    if (!articleId) {
      throw new Error('articleId is required');
    }

    // Update the reviewer record
    const updated = await tenantScopedTable(knex, 'kb_article_reviewers', tenant)
      .where({
        article_id: articleId,
        user_id: user.user_id,
      })
      .update({
        review_status: status,
        review_notes: notes || null,
        reviewed_at: knex.fn.now(),
      });

    if (updated === 0) {
      throw new Error('You are not assigned as a reviewer for this article');
    }

    // Update article's last_reviewed metadata
    await tenantScopedTable(knex, 'kb_articles', tenant)
      .where({ article_id: articleId })
      .update({
        last_reviewed_at: knex.fn.now(),
        last_reviewed_by: user.user_id,
        updated_at: knex.fn.now(),
        updated_by: user.user_id,
      });

    return true;
  }
);

/**
 * Gets available categories for KB article metadata and filters.
 */
export const getKnowledgeBaseCategories = withAuth(
  async (
    user,
    { tenant }
  ): Promise<IKBArticleCategory[] | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    if (!tenant || !(await hasPermission(user, 'document', 'read'))) {
      return permissionError('Permission denied', 'documents:errors.permissions.denied');
    }

    const db = tenantDb(knex, tenant);
    const categoriesQuery = tenantScopedTable(knex, 'categories as c', tenant);
    db.tenantJoin(categoriesQuery, 'categories as p', 'p.category_id', 'c.parent_category', { type: 'left' });

    const rows = await categoriesQuery
      .select(
        'c.category_id as id',
        'c.category_name as name',
        'p.category_name as parentName'
      )
      .orderBy('c.category_name', 'asc');

    return rows.map((row: { id: string; name: string; parentName?: string | null }) => ({
      id: row.id,
      name: row.parentName ? `${row.parentName} / ${row.name}` : row.name,
    }));
  }
);

/**
 * Gets paginated articles with filters.
 * F087: Returns paginated articles with audience/status/type/category filters.
 */
export const getArticles = withAuth(
  async (
    user,
    { tenant },
    page: number = 1,
    pageSize: number = 20,
    filters: IArticleFilters = {}
  ): Promise<{ articles: IKBArticleWithDocument[]; total: number; totalPages: number } | ActionPermissionError> => {
    // Cap pageSize to prevent excessive queries
    const effectivePageSize = Math.min(Math.max(pageSize, 1), 100);

    const { knex } = await createTenantKnex();

    if (!(await hasPermission(user, 'document', 'read'))) {
      return permissionError('Permission denied', 'documents:errors.permissions.denied');
    }

    let query = tenantScopedTable(knex, 'kb_articles as ka', tenant)
      .select([
        ...KB_ARTICLE_SELECT_COLUMNS.map((col) => `ka.${col}`),
        'd.document_name',
      ]);
    tenantDb(knex, tenant).tenantJoin(query, 'documents as d', 'd.document_id', 'ka.document_id', { type: 'left' });

    if (filters.status) {
      query = query.andWhere('ka.status', filters.status);
    }

    if (filters.audience) {
      query = query.andWhere('ka.audience', filters.audience);
    }

    if (filters.articleType) {
      query = query.andWhere('ka.article_type', filters.articleType);
    }

    if (filters.categoryId) {
      query = query.andWhere('ka.category_id', filters.categoryId);
    }

    if (filters.search) {
      query = query.andWhere(function () {
        this.whereILike('d.document_name', `%${filters.search}%`)
          .orWhereILike('ka.slug', `%${filters.search}%`);
      });
    }

    // Filter by tag IDs (legacy)
    if (filters.tagIds && filters.tagIds.length > 0) {
      const tagIdSubquery = tenantDb(knex, tenant).table('tag_mappings as tm')
        .select(knex.raw('1'))
        .whereRaw('tm.tagged_id = ka.article_id')
        .where('tm.tagged_type', 'knowledge_base_article')
        .whereIn('tm.tag_id', filters.tagIds as string[]);

      query = query.whereExists(tagIdSubquery);
    }

    // Filter by tag text (used by TagFilter component)
    if (filters.tags && filters.tags.length > 0) {
      const tagDb = tenantDb(knex, tenant);
      const tagTextSubquery = tagDb.table('tag_mappings as tm')
        .select('tm.tagged_id')
        .where('tm.tagged_type', 'knowledge_base_article')
        .whereIn('td.tag_text', filters.tags as string[]);
      tagDb.tenantJoin(tagTextSubquery, 'tag_definitions as td', 'tm.tag_id', 'td.tag_id');

      query = query.whereIn('ka.article_id', tagTextSubquery);
    }

    // Get total count
    const countResult = await query.clone().clearSelect().count('* as count').first();
    const total = parseInt((countResult as any)?.count || '0', 10);

    // Get paginated results
    const offset = (page - 1) * effectivePageSize;
    const articles = await query
      .orderBy('ka.updated_at', 'desc')
      .limit(effectivePageSize)
      .offset(offset);

    return {
      articles: articles as IKBArticleWithDocument[],
      total,
      totalPages: Math.ceil(total / effectivePageSize),
    };
  }
);

/**
 * Finds documents in /Knowledge Base that have no corresponding kb_articles
 * record and creates one for each, so they appear in the KB article list.
 */
async function reconcileOrphanedKBDocuments(
  knex: Knex,
  tenant: string,
  userId: string
): Promise<void> {
  const db = tenantDb(knex, tenant);
  const orphanedQuery = tenantScopedTable(knex, 'documents as d', tenant);
  db.tenantJoin(orphanedQuery, 'kb_articles as ka', 'ka.document_id', 'd.document_id', { type: 'left' });

  const orphaned = await orphanedQuery
    .where('d.folder_path', '/Knowledge Base')
    .whereNull('ka.article_id')
    .select('d.document_id', 'd.document_name');

  if (orphaned.length === 0) return;

  // Collect existing slugs to avoid collisions
  const existingSlugs = await tenantScopedTable(knex, 'kb_articles', tenant)
    .select('slug');
  const slugSet = new Set(existingSlugs.map((r: { slug: string }) => r.slug));

  const records = orphaned.map((doc: { document_id: string; document_name: string }) => {
    let slug = generateSlug(doc.document_name || 'untitled');
    while (slugSet.has(slug)) {
      slug = `${slug}-${randomUUID().slice(0, 8)}`;
    }
    slugSet.add(slug);

    return {
      tenant,
      article_id: randomUUID(),
      document_id: doc.document_id,
      slug,
      article_type: 'how_to' as ArticleType,
      audience: 'internal' as ArticleAudience,
      status: 'draft' as ArticleStatus,
      created_by: userId,
      updated_by: userId,
    };
  });

  await tenantScopedTable(knex, 'kb_articles', tenant).insert(records);
}

/**
 * Consolidated action: returns paginated articles, their tags, and available
 * filter tags in a single server round-trip. Also reconciles any documents
 * in /Knowledge Base that are missing a kb_articles record.
 */
export const getArticlesWithTags = withAuth(
  async (
    user,
    { tenant },
    page: number = 1,
    pageSize: number = 20,
    filters: IArticleFilters = {}
  ): Promise<{
    articles: IKBArticleWithDocument[];
    total: number;
    totalPages: number;
    articleTags: Record<string, ITag[]>;
    availableTags: ITag[];
  } | ActionPermissionError> => {
    const effectivePageSize = Math.min(Math.max(pageSize, 1), 100);
    const { knex } = await createTenantKnex();

    if (!(await hasPermission(user, 'document', 'read'))) {
      return permissionError('Permission denied', 'documents:errors.permissions.denied');
    }

    // Auto-create kb_articles for orphaned /Knowledge Base documents
    await reconcileOrphanedKBDocuments(knex, tenant, user.user_id);

    // --- articles query (same logic as getArticles) ---
    let query = tenantScopedTable(knex, 'kb_articles as ka', tenant)
      .select([
        ...KB_ARTICLE_SELECT_COLUMNS.map((col) => `ka.${col}`),
        'd.document_name',
      ]);
    tenantDb(knex, tenant).tenantJoin(query, 'documents as d', 'd.document_id', 'ka.document_id', { type: 'left' });

    if (filters.status) {
      query = query.andWhere('ka.status', filters.status);
    }
    if (filters.audience) {
      query = query.andWhere('ka.audience', filters.audience);
    }
    if (filters.articleType) {
      query = query.andWhere('ka.article_type', filters.articleType);
    }
    if (filters.categoryId) {
      query = query.andWhere('ka.category_id', filters.categoryId);
    }
    if (filters.search) {
      query = query.andWhere(function () {
        this.whereILike('d.document_name', `%${filters.search}%`)
          .orWhereILike('ka.slug', `%${filters.search}%`);
      });
    }
    if (filters.tagIds && filters.tagIds.length > 0) {
      const tagIdSubquery = tenantDb(knex, tenant).table('tag_mappings as tm')
        .select(knex.raw('1'))
        .whereRaw('tm.tagged_id = ka.article_id')
        .where('tm.tagged_type', 'knowledge_base_article')
        .whereIn('tm.tag_id', filters.tagIds as string[]);

      query = query.whereExists(tagIdSubquery);
    }
    if (filters.tags && filters.tags.length > 0) {
      const tagDb = tenantDb(knex, tenant);
      const tagTextSubquery = tagDb.table('tag_mappings as tm')
        .select('tm.tagged_id')
        .where('tm.tagged_type', 'knowledge_base_article')
        .whereIn('td.tag_text', filters.tags as string[]);
      tagDb.tenantJoin(tagTextSubquery, 'tag_definitions as td', 'tm.tag_id', 'td.tag_id');

      query = query.whereIn('ka.article_id', tagTextSubquery);
    }

    const countResult = await query.clone().clearSelect().count('* as count').first();
    const total = parseInt((countResult as any)?.count || '0', 10);

    const offset = (page - 1) * effectivePageSize;
    const articles = (await query
      .orderBy('ka.updated_at', 'desc')
      .limit(effectivePageSize)
      .offset(offset)) as IKBArticleWithDocument[];

    // --- tags for the current page of articles ---
    const articleIds = articles.map((a) => a.article_id);
    const articleTags: Record<string, ITag[]> = {};

    if (articleIds.length > 0) {
      const tagDb = tenantDb(knex, tenant);
      const tagRowsQuery = tenantScopedTable(knex, 'tag_mappings as tm', tenant)
        .where('tm.tagged_type', 'knowledge_base_article')
        .whereIn('tm.tagged_id', articleIds)
        .select(
          'tm.mapping_id as tag_id',
          'td.board_id',
          'td.tag_text',
          'tm.tagged_id',
          'tm.tagged_type',
          'td.background_color',
          'td.text_color',
          'tm.tenant'
        );
      tagDb.tenantJoin(tagRowsQuery, 'tag_definitions as td', 'tm.tag_id', 'td.tag_id');

      const tagRows = await tagRowsQuery;

      for (const tag of tagRows) {
        if (!articleTags[tag.tagged_id]) {
          articleTags[tag.tagged_id] = [];
        }
        articleTags[tag.tagged_id].push(tag as unknown as ITag);
      }
    }

    // --- available tags for filter sidebar ---
    const availableTagDefs = await tenantScopedTable(knex, 'tag_definitions as td', tenant)
      .distinctOn('td.tag_text')
      .select('td.*')
      .where('td.tagged_type', 'knowledge_base_article')
      .whereExists(
        tenantDb(knex, tenant).table('tag_mappings as tm')
          .select(knex.raw('1'))
          .whereRaw('tm.tag_id = td.tag_id')
      )
      .orderBy('td.tag_text', 'asc')
      .orderBy('td.created_at', 'asc');

    const availableTags: ITag[] = availableTagDefs.map((def: any) => ({
      tag_id: def.tag_id,
      tenant,
      board_id: def.board_id || undefined,
      tag_text: def.tag_text,
      tagged_id: '',
      tagged_type: def.tagged_type,
      background_color: def.background_color,
      text_color: def.text_color,
    }));

    return {
      articles,
      total,
      totalPages: Math.ceil(total / effectivePageSize),
      articleTags,
      availableTags,
    };
  }
);

/**
 * Gets a single article with its document content.
 * F088: Returns full article with document content.
 */
export const getArticle = withAuth(
  async (
    user,
    { tenant },
    articleId: string
  ): Promise<IKBArticleWithDocument | null | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    if (!(await hasPermission(user, 'document', 'read'))) {
      return permissionError('Permission denied', 'documents:errors.permissions.denied');
    }

    if (!articleId) {
      return null;
    }

    const db = tenantDb(knex, tenant);
    const articleQuery = tenantScopedTable(knex, 'kb_articles as ka', tenant)
      .select([
        ...KB_ARTICLE_SELECT_COLUMNS.map((col) => `ka.${col}`),
        'd.document_name',
        'd.content',
        'd.file_id',
        'd.mime_type',
        'dbc.block_data',
      ]);
    db.tenantJoin(articleQuery, 'documents as d', 'd.document_id', 'ka.document_id', { type: 'left' });
    db.tenantJoin(articleQuery, 'document_block_content as dbc', 'dbc.document_id', 'ka.document_id', { type: 'left' });

    const article = await articleQuery
      .andWhere('ka.article_id', articleId)
      .first();

    if (!article) {
      return null;
    }

    return article as IKBArticleWithDocument;
  }
);

/**
 * Gets articles that are past their review due date.
 * F089: Returns articles past next_review_due.
 */
export const getStaleArticles = withAuth(
  async (
    user,
    { tenant }
  ): Promise<IKBArticleWithDocument[] | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    if (!(await hasPermission(user, 'document', 'read'))) {
      return permissionError('Permission denied', 'documents:errors.permissions.denied');
    }

    const articlesQuery = tenantScopedTable(knex, 'kb_articles as ka', tenant)
      .select([
        ...KB_ARTICLE_SELECT_COLUMNS.map((col) => `ka.${col}`),
        'd.document_name',
      ]);
    tenantDb(knex, tenant).tenantJoin(articlesQuery, 'documents as d', 'd.document_id', 'ka.document_id', { type: 'left' });

    const articles = await articlesQuery
      .andWhere('ka.status', 'published')
      .andWhere('ka.next_review_due', '<=', knex.fn.now())
      .orderBy('ka.next_review_due', 'asc');

    return articles as IKBArticleWithDocument[];
  }
);

/**
 * Increments the view count for an article.
 * F090: Increments view_count.
 */
export const recordArticleView = withAuth(
  async (
    user,
    { tenant },
    articleId: string
  ): Promise<boolean | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    // No permission check - anyone who can view can record a view
    if (!articleId) {
      return false;
    }

    await tenantScopedTable(knex, 'kb_articles', tenant)
      .where({ article_id: articleId })
      .increment('view_count', 1);

    return true;
  }
);

/**
 * Records helpful/not helpful feedback.
 * F091: Increments helpful_count or not_helpful_count.
 */
export const recordArticleFeedback = withAuth(
  async (
    user,
    { tenant },
    articleId: string,
    helpful: boolean
  ): Promise<boolean | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    // No permission check - anyone can give feedback
    if (!articleId) {
      return false;
    }

    const column = helpful ? 'helpful_count' : 'not_helpful_count';

    await tenantScopedTable(knex, 'kb_articles', tenant)
      .where({ article_id: articleId })
      .increment(column, 1);

    return true;
  }
);

/**
 * Gets KB article templates.
 * F092: Returns KB article templates.
 */
export const getArticleTemplates = withAuth(
  async (
    user,
    { tenant },
    articleType?: ArticleType
  ): Promise<IKBArticleTemplate[] | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    if (!(await hasPermission(user, 'document', 'read'))) {
      return permissionError('Permission denied', 'documents:errors.permissions.denied');
    }

    let query = tenantScopedTable(knex, 'kb_article_templates', tenant)
      .select([
        'template_id', 'tenant', 'name', 'description',
        'article_type', 'is_default', 'created_at', 'updated_at',
      ]);

    if (articleType) {
      query = query.andWhere('article_type', articleType);
    }

    const templates = await query.orderBy('name', 'asc');

    return templates as IKBArticleTemplate[];
  }
);

// ---------------------------------------------------------------------------
// Import articles from uploaded files
// ---------------------------------------------------------------------------

export interface IImportFileInput {
  filename: string;
  content: string;
}

export interface IImportArticlesInput {
  files: IImportFileInput[];
  audience?: ArticleAudience;
  articleType?: ArticleType;
  categoryId?: string;
}

export interface IImportResult {
  total: number;
  imported: number;
  failed: Array<{ filename: string; error: string }>;
}

export type ImportJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface IStartArticleImportResult {
  jobId: string;
  total: number;
}

export interface IArticleImportStatus extends IImportResult {
  status: ImportJobStatus;
}

/** Job name is inlined: a vertical package must not import @alga-psa/jobs. */
const KB_ARTICLE_IMPORT_JOB = 'kb-article-import';

/** How long an unconsumed staging row may keep its file content. */
const KB_IMPORT_STAGING_TTL_MS = 24 * 60 * 60 * 1000;

function importFileExtension(filename: string): string {
  const match = /\.[^.]+$/.exec(filename.trim().toLowerCase());
  return match ? match[0] : '';
}

/**
 * Stages uploaded markdown/HTML files and hands the parsing to the
 * 'kb-article-import' background job. Parsing a multi-megabyte file used to run
 * inline in this action and could block the event loop for minutes; the action
 * now only validates and writes staging rows.
 */
export const startArticleImport = withAuth(
  async (
    user,
    { tenant },
    input: IImportArticlesInput
  ): Promise<IStartArticleImportResult | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    if (!(await hasPermission(user, 'document', 'create'))) {
      return permissionError('Permission denied', 'documents:errors.permissions.denied');
    }

    const files = input.files ?? [];
    if (files.length === 0) {
      throw new Error('No files provided');
    }
    if (files.length > KB_IMPORT_MAX_FILES) {
      throw new Error(`You can import at most ${KB_IMPORT_MAX_FILES} files at a time`);
    }

    let totalBytes = 0;
    for (const file of files) {
      if (!file.filename?.trim()) {
        throw new Error('Each file must have a name');
      }
      if (!KB_IMPORT_ALLOWED_EXTENSIONS.includes(importFileExtension(file.filename))) {
        throw new Error(`${file.filename}: unsupported file type. Use .md or .html`);
      }
      if (!file.content?.trim()) {
        throw new Error(`${file.filename} is empty`);
      }
      const fileBytes = Buffer.byteLength(file.content, 'utf8');
      if (fileBytes > KB_IMPORT_MAX_FILE_BYTES) {
        throw new Error(
          `${file.filename} is larger than ${Math.floor(KB_IMPORT_MAX_FILE_BYTES / (1024 * 1024))}MB`,
        );
      }
      totalBytes += fileBytes;
      if (totalBytes > KB_IMPORT_MAX_TOTAL_BYTES) {
        throw new Error(
          `This batch is larger than ${Math.floor(KB_IMPORT_MAX_TOTAL_BYTES / (1024 * 1024))}MB. Import fewer files at once.`,
        );
      }
    }

    // Swept opportunistically, whatever the row's status. Pending rows the
    // handler never consumed — a crash between the insert and the enqueue below
    // — would otherwise keep their file content forever, and settled rows would
    // pile up one per imported file for the life of the tenant. The job itself
    // finishes in minutes and nothing polls a batch after that, so a day is far
    // past the point where any row is still of interest.
    await tenantScopedTable(knex, 'kb_import_files', tenant)
      .where('created_at', '<', new Date(Date.now() - KB_IMPORT_STAGING_TTL_MS))
      .del()
      .catch(() => {});

    // Rows are written before the job is enqueued so the handler can never win
    // the race and find nothing to import. The batch id is replaced by the job
    // record id below, which is what the status action polls on.
    const importBatchId = randomUUID();
    const now = new Date();
    const rows = files.map((file) => ({
      tenant,
      import_file_id: randomUUID(),
      job_id: importBatchId,
      filename: file.filename,
      content: file.content,
      status: 'pending',
      audience: input.audience || 'internal',
      article_type: input.articleType || 'reference',
      category_id: input.categoryId || null,
      created_at: now,
      updated_at: now,
    }));

    await tenantScopedTable(knex, 'kb_import_files', tenant).insert(rows);

    const fileIds = rows.map((row) => row.import_file_id);

    // A failure here leaves the staged rows behind on purpose. On EE the enqueue
    // can throw after the workflow has already started, and deleting the rows
    // would pull the file content out from under a handler mid-import; the sweep
    // above collects them a day later instead.
    const { jobId } = await enqueueImmediateJob(KB_ARTICLE_IMPORT_JOB, {
      tenantId: tenant,
      userId: user.user_id,
      fileIds,
      metadata: { user_id: user.user_id, tenantId: tenant, fileCount: fileIds.length },
    });

    // The rows were written under a batch id because the job record id does not
    // exist until the job is enqueued. Re-key them so the status action can also
    // see the job row — but never fail the import over it. The job is already
    // running, and reporting failure would earn a retry that imports the whole
    // batch a second time. Polling falls back to the batch id, which the rows
    // still carry, and which the status action reads the same way.
    let pollId = jobId;
    try {
      await tenantScopedTable(knex, 'kb_import_files', tenant)
        .where({ job_id: importBatchId })
        .update({ job_id: jobId, updated_at: new Date() });
    } catch (error) {
      pollId = importBatchId;
      console.warn('[kbArticleImport] Could not re-key staged rows to the job id', {
        jobId,
        importBatchId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { jobId: pollId, total: rows.length };
  }
);

/**
 * Progress for a running import, polled by the import dialog.
 */
export const getArticleImportStatus = withAuth(
  async (
    user,
    { tenant },
    jobId: string
  ): Promise<IArticleImportStatus | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    if (!(await hasPermission(user, 'document', 'create'))) {
      return permissionError('Permission denied', 'documents:errors.permissions.denied');
    }

    if (!jobId) {
      throw new Error('jobId is required');
    }

    const rows: Array<{ filename: string; status: string; error: string | null }> =
      await tenantScopedTable(knex, 'kb_import_files', tenant)
        .where({ job_id: jobId })
        .select(['filename', 'status', 'error'])
        .orderBy('created_at', 'asc');

    const job = await tenantScopedTable(knex, 'jobs', tenant)
      .where({ job_id: jobId })
      .first('status');

    const imported = rows.filter((row) => row.status === 'imported').length;
    const failed = rows
      .filter(
        (row) => row.status === 'failed' || (job?.status === 'failed' && row.status !== 'imported'),
      )
      .map((row) => ({ filename: row.filename, error: row.error || 'Failed to import article' }));
    const settled = imported + failed.length === rows.length && rows.length > 0;

    let status: ImportJobStatus = 'processing';
    if (job?.status === 'failed') {
      status = 'failed';
    } else if (settled || job?.status === 'completed') {
      status = 'completed';
    } else if (job?.status === 'pending' && imported + failed.length === 0) {
      status = 'pending';
    }

    return { status, total: rows.length, imported, failed };
  }
);

/**
 * Creates an article pre-populated from a ticket's resolution data.
 * F093: Pre-populates article from ticket resolution data.
 */
export const createArticleFromTicket = withAuth(
  async (
    user,
    { tenant },
    ticketId: string
  ): Promise<IKBArticleWithDocument | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    if (!(await hasPermission(user, 'document', 'create'))) {
      return permissionError('Permission denied', 'documents:errors.permissions.denied');
    }

    if (!ticketId) {
      throw new Error('ticketId is required');
    }

    // Get the ticket
    const ticket = await tenantScopedTable(knex, 'tickets', tenant)
      .where({ ticket_id: ticketId })
      .first();

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    // Build article content from ticket data
    const title = `${ticket.title} - Resolution`;
    const content = [
      {
        type: 'heading',
        props: { level: 2 },
        content: [{ type: 'text', text: 'Problem' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: ticket.description || 'No description provided.' }],
      },
      {
        type: 'heading',
        props: { level: 2 },
        content: [{ type: 'text', text: 'Resolution' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: ticket.resolution || 'Enter resolution details here.' }],
      },
    ];

    // Create the article through the shared model (avoids nested withAuth calls)
    const article = await createKbArticle(knex, { tenant, userId: user.user_id }, {
      title,
      articleType: 'troubleshooting',
      audience: 'internal',
      content,
    });

    await publishKbArticleCreated(tenant, article, user.user_id);

    return article;
  }
);
