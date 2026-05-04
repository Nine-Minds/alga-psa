'use server';

import { randomUUID } from 'crypto';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import type {
  ArticleAudience,
  ArticleStatus,
  ArticleType,
  IDocument,
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

const KB_ARTICLE_SELECT_COLUMNS = [
  'article_id',
  'tenant',
  'document_id',
  'slug',
  'article_type',
  'audience',
  'status',
  'next_review_due',
  'review_cycle_days',
  'last_reviewed_at',
  'last_reviewed_by',
  'view_count',
  'helpful_count',
  'not_helpful_count',
  'category_id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'published_at',
  'published_by',
] as const;

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 100);
}

/**
 * Internal helper for creating a KB article. Not wrapped in withAuth —
 * intended to be called from already-authenticated contexts.
 */
async function _createArticleInternal(
  knex: Knex,
  user: { user_id: string },
  tenant: string,
  input: ICreateArticleInput
): Promise<IKBArticleWithDocument> {
  if (!input.title?.trim()) {
    throw new Error('Title is required');
  }

  let slug = input.slug?.trim() || generateSlug(input.title);
  const articleType = input.articleType || 'how_to';
  const audience = input.audience || 'internal';

  // Ensure slug uniqueness — append a numeric suffix if needed
  const existingSlug = await knex('kb_articles')
    .where({ tenant, slug })
    .first();
  if (existingSlug) {
    // If the caller provided an explicit slug, treat collision as an error
    if (input.slug?.trim()) {
      throw new Error('An article with this slug already exists');
    }
    // Otherwise auto-deduplicate
    let suffix = 2;
    while (true) {
      const candidate = `${slug}-${suffix}`;
      const collision = await knex('kb_articles').where({ tenant, slug: candidate }).first();
      if (!collision) {
        slug = candidate;
        break;
      }
      suffix++;
    }
  }

  // Create the underlying document directly via knex
  const documentId = randomUUID();
  const now = new Date();

  await knex('documents').insert({
    tenant,
    document_id: documentId,
    document_name: input.title.trim(),
    user_id: user.user_id,
    created_by: user.user_id,
    order_number: 0,
    folder_path: '/Knowledge Base',
    entered_at: now,
    updated_at: now,
  });

  // Store block content if provided
  if (input.content && Array.isArray(input.content) && input.content.length > 0) {
    await knex('document_block_content').insert({
      content_id: randomUUID(),
      document_id: documentId,
      tenant,
      block_data: JSON.stringify(input.content),
      created_at: now,
      updated_at: now,
    });
  }

  const document = await knex('documents')
    .where({ tenant, document_id: documentId })
    .first() as IDocument;

  // Create the KB article record — clean up document on failure
  const articleId = randomUUID();
  const nextReviewDue = input.reviewCycleDays
    ? new Date(Date.now() + input.reviewCycleDays * 24 * 60 * 60 * 1000)
    : null;

  try {
    await knex('kb_articles').insert({
      tenant,
      article_id: articleId,
      document_id: document.document_id,
      slug,
      article_type: articleType,
      audience,
      status: 'draft',
      review_cycle_days: input.reviewCycleDays || null,
      next_review_due: nextReviewDue,
      category_id: input.categoryId || null,
      created_by: user.user_id,
      updated_by: user.user_id,
    });
  } catch (err) {
    // Clean up orphaned document if kb_articles insert fails
    await knex('documents')
      .where({ tenant, document_id: document.document_id })
      .del()
      .catch(() => {}); // best effort cleanup
    throw err;
  }

  const article = await knex('kb_articles')
    .select(KB_ARTICLE_SELECT_COLUMNS)
    .where({ tenant, article_id: articleId })
    .first();

  return {
    ...article,
    document,
    document_name: document.document_name,
  } as unknown as IKBArticleWithDocument;
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
      return permissionError('Permission denied');
    }

    return _createArticleInternal(knex, user, tenant, input);
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
      return permissionError('Permission denied');
    }

    if (!articleId) {
      throw new Error('articleId is required');
    }

    return withTransaction(knex, async (trx) => {
      const existing = await trx('kb_articles')
        .where({ tenant, article_id: articleId })
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
        await trx('documents')
          .where({ tenant, document_id: existing.document_id })
          .update({
            document_name: input.title.trim(),
            updated_at: trx.fn.now(),
          });
      }

      if (input.slug !== undefined) {
        const newSlug = input.slug.trim();
        const existingSlug = await trx('kb_articles')
          .where({ tenant, slug: newSlug })
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

      await trx('kb_articles')
        .where({ tenant, article_id: articleId })
        .update(updates);

      const article = await trx('kb_articles')
        .select(KB_ARTICLE_SELECT_COLUMNS)
        .where({ tenant, article_id: articleId })
        .first();

      return article as unknown as IKBArticle;
    });
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
      return permissionError('Permission denied');
    }

    if (!articleId) {
      throw new Error('articleId is required');
    }

    return withTransaction(knex, async (trx) => {
      const existing = await trx('kb_articles')
        .where({ tenant, article_id: articleId })
        .first();

      if (!existing) {
        throw new Error('Article not found');
      }

      // Update article status
      await trx('kb_articles')
        .where({ tenant, article_id: articleId })
        .update({
          status: 'published',
          published_at: trx.fn.now(),
          published_by: user.user_id,
          updated_at: trx.fn.now(),
          updated_by: user.user_id,
        });

      // Auto-set is_client_visible for client/public audience
      if (existing.audience === 'client' || existing.audience === 'public') {
        await trx('documents')
          .where({ tenant, document_id: existing.document_id })
          .update({
            is_client_visible: true,
            updated_at: trx.fn.now(),
          });
      }

      const article = await trx('kb_articles')
        .select(KB_ARTICLE_SELECT_COLUMNS)
        .where({ tenant, article_id: articleId })
        .first();

      return article as unknown as IKBArticle;
    });
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
      return permissionError('Permission denied');
    }

    if (!articleId) {
      throw new Error('articleId is required');
    }

    return withTransaction(knex, async (trx) => {
      const existing = await trx('kb_articles')
        .where({ tenant, article_id: articleId })
        .first();

      if (!existing) {
        throw new Error('Article not found');
      }

      // Update article status
      await trx('kb_articles')
        .where({ tenant, article_id: articleId })
        .update({
          status: 'archived',
          updated_at: trx.fn.now(),
          updated_by: user.user_id,
        });

      // Clear is_client_visible
      await trx('documents')
        .where({ tenant, document_id: existing.document_id })
        .update({
          is_client_visible: false,
          updated_at: trx.fn.now(),
        });

      const article = await trx('kb_articles')
        .select(KB_ARTICLE_SELECT_COLUMNS)
        .where({ tenant, article_id: articleId })
        .first();

      return article as unknown as IKBArticle;
    });
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
      return permissionError('Permission denied');
    }

    if (!articleId) {
      throw new Error('articleId is required');
    }

    return withTransaction(knex, async (trx) => {
      const existing = await trx('kb_articles')
        .where({ tenant, article_id: articleId })
        .first();

      if (!existing) {
        throw new Error('Article not found');
      }

      if (existing.status !== 'draft' && existing.status !== 'archived') {
        throw new Error('Only draft or archived articles can be deleted. Archive the article first.');
      }

      await trx('tag_mappings')
        .where({ tenant, tagged_id: articleId, tagged_type: 'knowledge_base_article' })
        .del();

      await trx('kb_articles')
        .where({ tenant, article_id: articleId })
        .del();

      await trx('document_block_content')
        .where({ tenant, document_id: existing.document_id })
        .del();

      await trx('documents')
        .where({ tenant, document_id: existing.document_id })
        .del();

      return { success: true };
    });
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
      return permissionError('Permission denied');
    }

    if (!articleId) {
      throw new Error('articleId is required');
    }

    if (!reviewerUserIds?.length) {
      throw new Error('At least one reviewer is required');
    }

    const existing = await knex('kb_articles')
      .where({ tenant, article_id: articleId })
      .first();

    if (!existing) {
      throw new Error('Article not found');
    }

    // Update article status to review
    await knex('kb_articles')
      .where({ tenant, article_id: articleId })
      .update({
        status: 'review',
        updated_at: knex.fn.now(),
        updated_by: user.user_id,
      });

    // Validate all reviewer user IDs belong to this tenant
    const validUsers = await knex('users')
      .select('user_id')
      .where('tenant', tenant)
      .whereIn('user_id', reviewerUserIds);
    const validUserIds = new Set(validUsers.map((u: { user_id: string }) => u.user_id));
    const invalidIds = reviewerUserIds.filter((id) => !validUserIds.has(id));
    if (invalidIds.length > 0) {
      throw new Error(`Invalid reviewer user IDs: ${invalidIds.join(', ')}`);
    }

    // Create reviewer assignments (remove existing pending ones first)
    await knex('kb_article_reviewers')
      .where({ tenant, article_id: articleId, review_status: 'pending' })
      .del();

    const reviewerRecords = reviewerUserIds.map((userId) => ({
      tenant,
      reviewer_id: randomUUID(),
      article_id: articleId,
      user_id: userId,
      review_status: 'pending',
      assigned_by: user.user_id,
    }));

    await knex('kb_article_reviewers').insert(reviewerRecords);

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
      return permissionError('Permission denied');
    }

    if (!articleId) {
      throw new Error('articleId is required');
    }

    // Update the reviewer record
    const updated = await knex('kb_article_reviewers')
      .where({
        tenant,
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
    await knex('kb_articles')
      .where({ tenant, article_id: articleId })
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
      return permissionError('Permission denied');
    }

    let query = knex('kb_articles as ka')
      .select([
        ...KB_ARTICLE_SELECT_COLUMNS.map((col) => `ka.${col}`),
        'd.document_name',
      ])
      .leftJoin('documents as d', function () {
        this.on('d.document_id', '=', 'ka.document_id').andOn('d.tenant', '=', 'ka.tenant');
      })
      .where('ka.tenant', tenant);

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
      query = query.whereExists(function () {
        this.select(knex.raw('1'))
          .from('tag_mappings as tm')
          .whereRaw('tm.tagged_id = ka.article_id')
          .whereRaw('tm.tenant = ka.tenant')
          .where('tm.tagged_type', 'knowledge_base_article')
          .whereIn('tm.tag_id', filters.tagIds as string[]);
      });
    }

    // Filter by tag text (used by TagFilter component)
    if (filters.tags && filters.tags.length > 0) {
      query = query.whereIn('ka.article_id', function () {
        this.select('tm.tagged_id')
          .from('tag_mappings as tm')
          .join('tag_definitions as td', function () {
            this.on('tm.tenant', '=', 'td.tenant').andOn('tm.tag_id', '=', 'td.tag_id');
          })
          .where('tm.tagged_type', 'knowledge_base_article')
          .whereRaw('tm.tenant = ka.tenant')
          .whereIn('td.tag_text', filters.tags as string[]);
      });
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
  const orphaned = await knex('documents as d')
    .leftJoin('kb_articles as ka', function () {
      this.on('ka.document_id', '=', 'd.document_id').andOn('ka.tenant', '=', 'd.tenant');
    })
    .where('d.tenant', tenant)
    .where('d.folder_path', '/Knowledge Base')
    .whereNull('ka.article_id')
    .select('d.document_id', 'd.document_name');

  if (orphaned.length === 0) return;

  // Collect existing slugs to avoid collisions
  const existingSlugs = await knex('kb_articles')
    .where('tenant', tenant)
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

  await knex('kb_articles').insert(records);
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
      return permissionError('Permission denied');
    }

    // Auto-create kb_articles for orphaned /Knowledge Base documents
    await reconcileOrphanedKBDocuments(knex, tenant, user.user_id);

    // --- articles query (same logic as getArticles) ---
    let query = knex('kb_articles as ka')
      .select([
        ...KB_ARTICLE_SELECT_COLUMNS.map((col) => `ka.${col}`),
        'd.document_name',
      ])
      .leftJoin('documents as d', function () {
        this.on('d.document_id', '=', 'ka.document_id').andOn('d.tenant', '=', 'ka.tenant');
      })
      .where('ka.tenant', tenant);

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
      query = query.whereExists(function () {
        this.select(knex.raw('1'))
          .from('tag_mappings as tm')
          .whereRaw('tm.tagged_id = ka.article_id')
          .whereRaw('tm.tenant = ka.tenant')
          .where('tm.tagged_type', 'knowledge_base_article')
          .whereIn('tm.tag_id', filters.tagIds as string[]);
      });
    }
    if (filters.tags && filters.tags.length > 0) {
      query = query.whereIn('ka.article_id', function () {
        this.select('tm.tagged_id')
          .from('tag_mappings as tm')
          .join('tag_definitions as td', function () {
            this.on('tm.tenant', '=', 'td.tenant').andOn('tm.tag_id', '=', 'td.tag_id');
          })
          .where('tm.tagged_type', 'knowledge_base_article')
          .whereRaw('tm.tenant = ka.tenant')
          .whereIn('td.tag_text', filters.tags as string[]);
      });
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
      const tagRows = await knex('tag_mappings as tm')
        .join('tag_definitions as td', function () {
          this.on('tm.tenant', '=', 'td.tenant').andOn('tm.tag_id', '=', 'td.tag_id');
        })
        .where('tm.tenant', tenant)
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

      for (const tag of tagRows) {
        if (!articleTags[tag.tagged_id]) {
          articleTags[tag.tagged_id] = [];
        }
        articleTags[tag.tagged_id].push(tag as unknown as ITag);
      }
    }

    // --- available tags for filter sidebar ---
    const availableTagsResult = await knex.raw(
      `SELECT DISTINCT ON (td.tag_text) td.*
       FROM tag_definitions td
       WHERE td.tenant = ?
         AND td.tagged_type = 'knowledge_base_article'
         AND EXISTS (
           SELECT 1 FROM tag_mappings tm
           WHERE tm.tenant = td.tenant AND tm.tag_id = td.tag_id
         )
       ORDER BY td.tag_text ASC, td.created_at ASC`,
      [tenant]
    );

    const availableTags: ITag[] = (availableTagsResult.rows || []).map((def: any) => ({
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
      return permissionError('Permission denied');
    }

    if (!articleId) {
      return null;
    }

    const article = await knex('kb_articles as ka')
      .select([
        ...KB_ARTICLE_SELECT_COLUMNS.map((col) => `ka.${col}`),
        'd.document_name',
        'd.content',
        'd.file_id',
        'd.mime_type',
        'dbc.block_data',
      ])
      .leftJoin('documents as d', function () {
        this.on('d.document_id', '=', 'ka.document_id').andOn('d.tenant', '=', 'ka.tenant');
      })
      .leftJoin('document_block_content as dbc', function () {
        this.on('dbc.document_id', '=', 'ka.document_id').andOn('dbc.tenant', '=', 'ka.tenant');
      })
      .where('ka.tenant', tenant)
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
      return permissionError('Permission denied');
    }

    const articles = await knex('kb_articles as ka')
      .select([
        ...KB_ARTICLE_SELECT_COLUMNS.map((col) => `ka.${col}`),
        'd.document_name',
      ])
      .leftJoin('documents as d', function () {
        this.on('d.document_id', '=', 'ka.document_id').andOn('d.tenant', '=', 'ka.tenant');
      })
      .where('ka.tenant', tenant)
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

    await knex('kb_articles')
      .where({ tenant, article_id: articleId })
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

    await knex('kb_articles')
      .where({ tenant, article_id: articleId })
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
      return permissionError('Permission denied');
    }

    let query = knex('kb_article_templates')
      .select([
        'template_id', 'tenant', 'name', 'description',
        'article_type', 'is_default', 'created_at', 'updated_at',
      ])
      .where('tenant', tenant);

    if (articleType) {
      query = query.andWhere('article_type', articleType);
    }

    const templates = await query.orderBy('name', 'asc');

    return templates as IKBArticleTemplate[];
  }
);

// ---------------------------------------------------------------------------
// Markdown / HTML → BlockNote conversion helpers
// ---------------------------------------------------------------------------

interface BlockNoteBlock {
  type: string;
  props?: Record<string, any>;
  content?:
    | Array<{ type: string; text: string; styles?: Record<string, boolean | Record<string, string>> }>
    | { type: 'tableContent'; rows: Array<{ cells: Array<Array<{ type: string; text: string; styles?: Record<string, boolean | Record<string, string>> }>>; isHeader?: boolean }> };
  children?: BlockNoteBlock[];
}

function isTableSeparatorRow(line: string): boolean {
  // Matches a GFM separator row like `| --- | :---: | ---: |`
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  // Strip leading/trailing pipes, then split. Cells are trimmed.
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function markdownToBlocks(markdown: string): BlockNoteBlock[] {
  const lines = markdown.split('\n');
  const blocks: BlockNoteBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ') || line === '>') {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      // Parse blockquote content as inline markdown
      const quoteText = quoteLines.join(' ');
      blocks.push({
        type: 'blockquote',
        content: parseInlineMarkdown(quoteText),
      });
      continue;
    }

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({
        type: 'codeBlock',
        props: { language: lang || 'plain' },
        content: [{ type: 'text', text: codeLines.join('\n') }],
      });
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        props: { level: headingMatch[1].length },
        content: parseInlineMarkdown(headingMatch[2]),
      });
      i++;
      continue;
    }

    // Unordered list items
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: BlockNoteBlock[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*[-*+]\s+/, '');
        items.push({
          type: 'bulletListItem',
          content: parseInlineMarkdown(text),
        });
        i++;
      }
      blocks.push(...items);
      continue;
    }

    // Ordered list items
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: BlockNoteBlock[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*\d+[.)]\s+/, '');
        items.push({
          type: 'numberedListItem',
          content: parseInlineMarkdown(text),
        });
        i++;
      }
      blocks.push(...items);
      continue;
    }

    // GFM table — header row, separator row (---), then body rows
    // Detect: current line looks like a row (`| a | b |` or `a | b`) and the next line is a separator.
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparatorRow(lines[i + 1])
    ) {
      const headerCells = splitTableRow(line);
      const bodyRows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim() && lines[j].includes('|')) {
        bodyRows.push(splitTableRow(lines[j]));
        j++;
      }
      const allRows = [
        { cells: headerCells, isHeader: true },
        ...bodyRows.map((cells) => ({ cells, isHeader: false })),
      ];
      blocks.push({
        type: 'table',
        content: {
          type: 'tableContent',
          rows: allRows.map((r) => ({
            isHeader: r.isHeader,
            cells: r.cells.map((cellText) => parseInlineMarkdown(cellText)),
          })),
        },
      });
      i = j;
      continue;
    }

    // Blank line → skip
    if (!line.trim()) {
      i++;
      continue;
    }

    // Regular paragraph — collect consecutive non-blank, non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('```') &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      // stop if a GFM table starts on the next line
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1]))
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({
        type: 'paragraph',
        content: parseInlineMarkdown(paraLines.join(' ')),
      });
    }
  }

  return blocks;
}

function parseInlineMarkdown(
  text: string
): Array<{ type: string; text: string; styles?: Record<string, boolean | Record<string, string>> }> {
  const segments: Array<{ type: string; text: string; styles?: Record<string, boolean | Record<string, string>> }> = [];
  // Handle **bold**, *italic*, `code`, and [text](url)
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    if (match[2]) {
      segments.push({ type: 'text', text: match[2], styles: { bold: true } });
    } else if (match[3]) {
      segments.push({ type: 'text', text: match[3], styles: { italic: true } });
    } else if (match[4]) {
      segments.push({ type: 'text', text: match[4], styles: { code: true } });
    } else if (match[5] && match[6]) {
      segments.push({ type: 'text', text: match[5], styles: { link: { href: match[6] } } });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: 'text', text }];
}

function htmlToBlocks(html: string): BlockNoteBlock[] {
  // Simple HTML → text conversion, then parse as markdown
  const text = html
    // Convert common block elements to newlines
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi, (_, level, content) => {
      return '#'.repeat(parseInt(level)) + ' ' + stripTags(content) + '\n\n';
    })
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gis, (_, content) => {
      return '```\n' + stripTags(content) + '\n```\n\n';
    })
    .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');

  return markdownToBlocks(stripTags(text));
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.(md|markdown|html|htm)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// ---------------------------------------------------------------------------
// Import articles from file contents
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

/**
 * Imports KB articles from markdown/HTML file contents.
 * Each file becomes one article. Filename → title, content → BlockNote blocks.
 */
export const importArticles = withAuth(
  async (
    user,
    { tenant },
    input: IImportArticlesInput
  ): Promise<IImportResult | ActionPermissionError> => {
    const { knex } = await createTenantKnex();

    if (!(await hasPermission(user, 'document', 'create'))) {
      return permissionError('Permission denied');
    }

    if (!input.files?.length) {
      throw new Error('No files provided');
    }

    const result: IImportResult = { total: input.files.length, imported: 0, failed: [] };

    for (const file of input.files) {
      try {
        const title = titleFromFilename(file.filename);
        const isHtml = /\.(html|htm)$/i.test(file.filename);
        const blocks = isHtml ? htmlToBlocks(file.content) : markdownToBlocks(file.content);

        // Deduplicate slug: append a suffix if needed
        let slug = generateSlug(title);
        const existingSlug = await knex('kb_articles').where({ tenant, slug }).first();
        if (existingSlug) {
          slug = `${slug}-${Date.now()}`;
        }

        await _createArticleInternal(knex, user, tenant, {
          title,
          slug,
          content: blocks,
          articleType: input.articleType || 'reference',
          audience: input.audience || 'internal',
          categoryId: input.categoryId,
        });

        result.imported++;
      } catch (err) {
        result.failed.push({
          filename: file.filename,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return result;
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
      return permissionError('Permission denied');
    }

    if (!ticketId) {
      throw new Error('ticketId is required');
    }

    // Get the ticket
    const ticket = await knex('tickets')
      .where({ tenant, ticket_id: ticketId })
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

    // Create the article using internal helper (avoids nested withAuth calls)
    return _createArticleInternal(knex, user, tenant, {
      title,
      articleType: 'troubleshooting',
      audience: 'internal',
      content,
    });
  }
);
