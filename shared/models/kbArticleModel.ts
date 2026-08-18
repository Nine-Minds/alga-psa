/**
 * Shared KB Article Model - session-free article creation.
 *
 * Extracted from packages/documents kbArticleActions so background workers
 * (the Temporal job worker running the KB import job) can create articles with
 * an explicit knex/tenant/user context instead of a request session.
 */

import { randomUUID } from 'crypto';
import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import type {
  ArticleAudience,
  ArticleType,
  IDocument,
  IKBArticleWithDocument,
} from '@alga-psa/types';

export interface CreateKbArticleInput {
  title: string;
  slug?: string;
  articleType?: ArticleType;
  audience?: ArticleAudience;
  categoryId?: string;
  reviewCycleDays?: number;
  content?: any; // BlockNote JSON
}

export interface CreateKbArticleContext {
  tenant: string;
  userId: string;
}

export const KB_ARTICLE_SELECT_COLUMNS = [
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

export const KB_ARTICLE_TITLE_REQUIRED = 'Title is required';
export const KB_ARTICLE_SLUG_TAKEN = 'An article with this slug already exists';

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

export function generateKbArticleSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 100);
}

async function publishKbArticleCreated(
  tenant: string,
  article: IKBArticleWithDocument,
  userId: string,
): Promise<void> {
  try {
    await publishEvent({
      eventType: 'KB_ARTICLE_CREATED',
      payload: {
        tenantId: tenant,
        occurredAt: new Date().toISOString(),
        articleId: article.article_id,
        documentId: article.document_id,
        userId,
        changedFields: ['document_name', 'content'],
        status: article.status,
      },
    });
  } catch (eventError) {
    console.error('[kbArticleModel] Failed to publish KB_ARTICLE_CREATED search event:', eventError);
  }
}

/**
 * Creates a KB article and its underlying document, then publishes
 * KB_ARTICLE_CREATED so search indexing picks it up. Callers are responsible
 * for authorization — this runs with whatever connection/tenant it is handed.
 */
export async function createKbArticle(
  knex: Knex,
  context: CreateKbArticleContext,
  input: CreateKbArticleInput,
): Promise<IKBArticleWithDocument> {
  const { tenant, userId } = context;

  if (!input.title?.trim()) {
    throw new Error(KB_ARTICLE_TITLE_REQUIRED);
  }

  let slug = input.slug?.trim() || generateKbArticleSlug(input.title);
  const articleType = input.articleType || 'how_to';
  const audience = input.audience || 'internal';

  // Ensure slug uniqueness — append a numeric suffix if needed
  const existingSlug = await tenantScopedTable(knex, 'kb_articles', tenant)
    .where({ slug })
    .first();
  if (existingSlug) {
    // If the caller provided an explicit slug, treat collision as an error
    if (input.slug?.trim()) {
      throw new Error(KB_ARTICLE_SLUG_TAKEN);
    }
    // Otherwise auto-deduplicate
    let suffix = 2;
    while (true) {
      const candidate = `${slug}-${suffix}`;
      const collision = await tenantScopedTable(knex, 'kb_articles', tenant)
        .where({ slug: candidate })
        .first();
      if (!collision) {
        slug = candidate;
        break;
      }
      suffix++;
    }
  }

  // Create the underlying document.
  const documentId = randomUUID();
  const now = new Date();

  await tenantScopedTable(knex, 'documents', tenant).insert({
    tenant,
    document_id: documentId,
    document_name: input.title.trim(),
    user_id: userId,
    created_by: userId,
    order_number: 0,
    folder_path: '/Knowledge Base',
    entered_at: now,
    updated_at: now,
  });

  // Store block content if provided
  if (input.content && Array.isArray(input.content) && input.content.length > 0) {
    await tenantScopedTable(knex, 'document_block_content', tenant).insert({
      content_id: randomUUID(),
      document_id: documentId,
      tenant,
      block_data: JSON.stringify(input.content),
      created_at: now,
      updated_at: now,
    });
  }

  const document = await tenantScopedTable(knex, 'documents', tenant)
    .where({ document_id: documentId })
    .first() as IDocument;

  // Create the KB article record — clean up document on failure
  const articleId = randomUUID();
  const nextReviewDue = input.reviewCycleDays
    ? new Date(Date.now() + input.reviewCycleDays * 24 * 60 * 60 * 1000)
    : null;

  try {
    await tenantScopedTable(knex, 'kb_articles', tenant).insert({
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
      created_by: userId,
      updated_by: userId,
    });
  } catch (err) {
    // Clean up orphaned document if kb_articles insert fails
    await tenantScopedTable(knex, 'documents', tenant)
      .where({ document_id: document.document_id })
      .del()
      .catch(() => {}); // best effort cleanup
    throw err;
  }

  const article = await tenantScopedTable(knex, 'kb_articles', tenant)
    .select(KB_ARTICLE_SELECT_COLUMNS)
    .where({ article_id: articleId })
    .first();

  const created = {
    ...article,
    document,
    document_name: document.document_name,
  } as unknown as IKBArticleWithDocument;

  await publishKbArticleCreated(tenant, created, userId);

  return created;
}
