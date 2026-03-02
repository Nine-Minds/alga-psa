'use server';

import { IUser } from '@alga-psa/types';
import { Knex } from 'knex';
import { hasPermission, withAuth } from '@alga-psa/auth';
import { getConnection, withTransaction } from '@alga-psa/db';
import type {
  IKBArticleWithDocument,
  ArticleType,
} from '@alga-psa/documents/actions';

export interface ClientKBFilters {
  search?: string;
  articleType?: ArticleType;
  categoryId?: string;
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
 * Get the authenticated client user's client_id.
 */
async function getAuthenticatedClientId(
  trx: Knex.Transaction,
  userId: string,
  tenant: string
): Promise<string> {
  const userRecord = await trx('users')
    .where({
      user_id: userId,
      tenant: tenant,
    })
    .first();

  if (!userRecord?.contact_id) {
    throw new Error('User not associated with a contact');
  }

  const contact = await trx('contacts')
    .where({
      contact_name_id: userRecord.contact_id,
      tenant: tenant,
    })
    .first();

  if (!contact?.client_id) {
    throw new Error('Contact not associated with a client');
  }

  return contact.client_id;
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

    const db = await getConnection(tenant);

    const userForPermission = {
      user_id: user.user_id,
      email: user.email,
      user_type: user.user_type,
      is_inactive: false,
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

      // Get total count
      const countResult = await query.clone().clearSelect().count('* as count').first();
      const total = parseInt((countResult as any)?.count || '0', 10);

      // Get paginated results
      const offset = (page - 1) * pageSize;
      const articles = await query
        .orderBy('ka.published_at', 'desc')
        .limit(pageSize)
        .offset(offset);

      return {
        articles: articles as IKBArticleWithDocument[],
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
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

    const userForPermission = {
      user_id: user.user_id,
      email: user.email,
      user_type: user.user_type,
      is_inactive: false,
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
          'd.block_content',
        ])
        .leftJoin('documents as d', function () {
          this.on('d.document_id', '=', 'ka.document_id').andOn('d.tenant', '=', 'ka.tenant');
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
      // Get categories that have at least one published client/public article
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
            .whereRaw('ka.category_id = sc.id::text')
            .andWhere('ka.status', 'published')
            .whereIn('ka.audience', ['client', 'public']);
        })
        .orderBy('sc.display_order', 'asc');

      return categoriesWithArticles as ClientKBCategory[];
    });
  }
);
