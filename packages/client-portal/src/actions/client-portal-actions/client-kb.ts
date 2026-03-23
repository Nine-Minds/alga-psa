'use server';

import { IUser } from '@alga-psa/types';
import { Knex } from 'knex';
import { hasPermission, withAuth } from '@alga-psa/auth';
import { getConnection, withTransaction } from '@alga-psa/db';
import type {
  IKBArticleWithDocument,
  ArticleType,
} from '@alga-psa/types';
import { getAuthenticatedClientId } from '../../lib/clientAuth';

export interface ClientKBFilters {
  search?: string;
  articleType?: ArticleType;
  categoryId?: string;
  tags?: string[];
}

export interface PaginatedClientKBArticles {
  articles: IKBArticleWithDocument[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ClientKBCategory {
  id: string;
  name: string;
  parent_id: string | null;
}

/**
 * Returns paginated KB articles visible to client portal users.
 * Only shows published articles with audience='client' or 'public'.
 */
export const getClientKBArticles = withAuth(
  async (
    user,
    { tenant },
    page: number = 1,
    pageSize: number = 20,
    filters: ClientKBFilters = {}
  ): Promise<PaginatedClientKBArticles> => {
    // Enforce client portal access only
    if (user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    // Cap pageSize to prevent excessive queries
    const effectivePageSize = Math.min(Math.max(pageSize, 1), 100);

    const db = await getConnection(tenant);

    // Fetch real user record for permission check instead of hardcoding is_inactive
    const userRecord = await db('users')
      .select('user_id', 'email', 'user_type', 'is_inactive')
      .where({ user_id: user.user_id, tenant })
      .first();
    const userForPermission = {
      user_id: user.user_id,
      email: user.email,
      user_type: user.user_type,
      is_inactive: userRecord?.is_inactive ?? false,
      tenant,
    } as IUser;
    const canRead = await hasPermission(userForPermission, 'document', 'read', db);
    if (!canRead) {
      throw new Error('Insufficient permissions to view knowledge base');
    }

    return withTransaction(db, async (trx: Knex.Transaction) => {
      // Build query for client-visible published articles
      let query = trx('kb_articles as ka')
        .select([
          'ka.article_id',
          'ka.tenant',
          'ka.document_id',
          'ka.slug',
          'ka.article_type',
          'ka.audience',
          'ka.status',
          'ka.view_count',
          'ka.helpful_count',
          'ka.not_helpful_count',
          'ka.category_id',
          'ka.published_at',
          'd.document_name',
        ])
        .leftJoin('documents as d', function () {
          this.on('d.document_id', '=', 'ka.document_id').andOn('d.tenant', '=', 'ka.tenant');
        })
        .where('ka.tenant', tenant)
        .andWhere('ka.status', 'published')
        .whereIn('ka.audience', ['client', 'public']);

      // Apply filters
      if (filters.search) {
        query = query.andWhere(function () {
          this.whereILike('d.document_name', `%${filters.search}%`)
            .orWhereILike('ka.slug', `%${filters.search}%`);
        });
      }

      if (filters.articleType) {
        query = query.andWhere('ka.article_type', filters.articleType);
      }

      if (filters.categoryId) {
        query = query.andWhere('ka.category_id', filters.categoryId);
      }

      if (filters.tags && filters.tags.length > 0) {
        query = query.whereIn('ka.article_id', function () {
          this.select('tm.tagged_id')
            .from('tag_mappings as tm')
            .join('tag_definitions as td', function () {
              this.on('tm.tenant', '=', 'td.tenant').andOn('tm.tag_id', '=', 'td.tag_id');
            })
            .where('tm.tagged_type', 'knowledge_base_article')
            .andWhere('tm.tenant', tenant)
            .whereIn('td.tag_text', filters.tags as readonly string[]);
        });
      }

      // Get total count
      const countResult = await query.clone().clearSelect().count('* as count').first();
      const total = parseInt((countResult as any)?.count || '0', 10);

      // Get paginated results
      const offset = (page - 1) * effectivePageSize;
      const articles = await query
        .orderBy('ka.published_at', 'desc')
        .limit(effectivePageSize)
        .offset(offset);

      return {
        articles: articles as IKBArticleWithDocument[],
        total,
        page,
        pageSize: effectivePageSize,
        totalPages: Math.ceil(total / effectivePageSize),
      };
    });
  }
);

/**
 * Gets a single KB article by ID or slug for client portal viewing.
 * Only returns published articles with client or public audience.
 * Increments view count on successful retrieval.
 */
export const getClientKBArticle = withAuth(
  async (
    user,
    { tenant },
    articleIdOrSlug: string
  ): Promise<IKBArticleWithDocument | null> => {
    // Enforce client portal access only
    if (user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    const db = await getConnection(tenant);

    // Fetch real user record for permission check instead of hardcoding is_inactive
    const userRecord = await db('users')
      .select('user_id', 'email', 'user_type', 'is_inactive')
      .where({ user_id: user.user_id, tenant })
      .first();
    const userForPermission = {
      user_id: user.user_id,
      email: user.email,
      user_type: user.user_type,
      is_inactive: userRecord?.is_inactive ?? false,
      tenant,
    } as IUser;
    const canRead = await hasPermission(userForPermission, 'document', 'read', db);
    if (!canRead) {
      throw new Error('Insufficient permissions to view knowledge base');
    }

    return withTransaction(db, async (trx: Knex.Transaction) => {
      // Try to find by ID first, then by slug
      let article = await trx('kb_articles as ka')
        .select([
          'ka.article_id',
          'ka.tenant',
          'ka.document_id',
          'ka.slug',
          'ka.article_type',
          'ka.audience',
          'ka.status',
          'ka.view_count',
          'ka.helpful_count',
          'ka.not_helpful_count',
          'ka.category_id',
          'ka.published_at',
          'ka.created_at',
          'ka.updated_at',
          'd.document_name',
          'dbc.block_data',
        ])
        .leftJoin('documents as d', function () {
          this.on('d.document_id', '=', 'ka.document_id').andOn('d.tenant', '=', 'ka.tenant');
        })
        .leftJoin('document_block_content as dbc', function () {
          this.on('dbc.document_id', '=', 'ka.document_id').andOn('dbc.tenant', '=', 'ka.tenant');
        })
        .where('ka.tenant', tenant)
        .andWhere('ka.status', 'published')
        .whereIn('ka.audience', ['client', 'public'])
        .andWhere(function () {
          this.where('ka.article_id', articleIdOrSlug)
            .orWhere('ka.slug', articleIdOrSlug);
        })
        .first();

      if (!article) {
        return null;
      }

      // Increment view count
      await trx('kb_articles')
        .where({ tenant, article_id: article.article_id })
        .increment('view_count', 1);

      // Return with incremented count
      return {
        ...article,
        view_count: article.view_count + 1,
      } as IKBArticleWithDocument;
    });
  }
);

/**
 * Records feedback (helpful/not helpful) for a KB article.
 */
export const recordClientKBFeedback = withAuth(
  async (
    user,
    { tenant },
    articleId: string,
    helpful: boolean
  ): Promise<boolean> => {
    // Enforce client portal access only
    if (user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    const db = await getConnection(tenant);

    return withTransaction(db, async (trx: Knex.Transaction) => {
      // Verify article exists and is accessible
      const article = await trx('kb_articles')
        .where({ tenant, article_id: articleId, status: 'published' })
        .whereIn('audience', ['client', 'public'])
        .first();

      if (!article) {
        throw new Error('Article not found or not accessible');
      }

      // Increment the appropriate counter
      const column = helpful ? 'helpful_count' : 'not_helpful_count';
      await trx('kb_articles')
        .where({ tenant, article_id: articleId })
        .increment(column, 1);

      return true;
    });
  }
);

/**
 * Gets KB categories for filtering in client portal.
 * Returns standard categories that have at least one published client/public article.
 */
export const getClientKBCategories = withAuth(
  async (
    user,
    { tenant }
  ): Promise<ClientKBCategory[]> => {
    // Enforce client portal access only
    if (user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    const db = await getConnection(tenant);

    return withTransaction(db, async (trx: Knex.Transaction) => {
      // standard_categories is a global reference table (no tenant column) — no tenant filter needed.
      // Tenant scoping comes from the kb_articles subquery which filters by tenant.
      const categoriesWithArticles = await trx('standard_categories as sc')
        .select([
          'sc.id',
          'sc.category_name as name',
          'sc.parent_category_uuid as parent_id',
        ])
        .whereExists(function () {
          this.select('*')
            .from('kb_articles as ka')
            .where('ka.tenant', tenant)
            .whereRaw('ka.category_id::text = sc.id::text')
            .andWhere('ka.status', 'published')
            .whereIn('ka.audience', ['client', 'public']);
        })
        .orderBy('sc.display_order', 'asc');

      return categoriesWithArticles as ClientKBCategory[];
    });
  }
);

/**
 * Gets unique tags used on published client/public KB articles.
 */
export const getClientKBTags = withAuth(
  async (
    user,
    { tenant }
  ): Promise<Array<{ tag_id: string; tag_text: string; tagged_id: string; tagged_type: string; background_color: string | null; text_color: string | null }>> => {
    if (user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    const db = await getConnection(tenant);

    return withTransaction(db, async (trx: Knex.Transaction) => {
      const result = await trx.raw(`
        SELECT DISTINCT ON (td.tag_text) td.tag_id, td.tag_text, td.background_color, td.text_color
        FROM tag_definitions td
        WHERE td.tenant = ?
          AND td.tagged_type = 'knowledge_base_article'
          AND EXISTS (
            SELECT 1 FROM tag_mappings tm
            JOIN kb_articles ka ON ka.article_id = tm.tagged_id AND ka.tenant = tm.tenant
            WHERE tm.tenant = td.tenant
              AND tm.tag_id = td.tag_id
              AND ka.status = 'published'
              AND ka.audience IN ('client', 'public')
          )
        ORDER BY td.tag_text ASC, td.created_at ASC
      `, [tenant]);

      return (result?.rows || []).map((tag: any) => ({
        tag_id: tag.tag_id,
        tag_text: tag.tag_text,
        tagged_id: '',
        tagged_type: 'knowledge_base_article' as const,
        background_color: tag.background_color,
        text_color: tag.text_color,
      }));
    });
  }
);
