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

export interface KbArticleVisibilityState {
  status: string;
  audience: string;
}

/**
 * The single rule for KB client visibility (D2): a KB document is visible to
 * clients iff its article is published AND aimed at clients or the public.
 * documents.is_client_visible on a KB document is derived from this, never set
 * independently.
 */
export function isKbArticleClientVisible(article: KbArticleVisibilityState): boolean {
  return article.status === 'published' && (article.audience === 'client' || article.audience === 'public');
}

/**
 * Re-derives documents.is_client_visible from the post-write article state.
 * Callers must hold a row lock on the kb_articles row (select ... for update)
 * inside the same transaction. Writes only when the value differs.
 */
export async function syncKbArticleClientVisibility(
  trx: Knex.Transaction,
  tenant: string,
  article: KbArticleVisibilityState & { document_id: string },
): Promise<boolean> {
  const visible = isKbArticleClientVisible(article);
  const updated = await tenantScopedTable(trx, 'documents', tenant)
    .where({ document_id: article.document_id })
    .whereRaw('is_client_visible is distinct from ?', [visible])
    .update({ is_client_visible: visible, updated_at: trx.fn.now() });
  return updated > 0;
}

function textParagraph(text: string): Record<string, any> {
  return { type: 'paragraph', content: [{ type: 'text', text, styles: {} }] };
}

function heading(text: string): Record<string, any> {
  return { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text, styles: {} }] };
}

export const KB_TICKET_PROBLEM_PLACEHOLDER = 'No description provided.';
export const KB_TICKET_RESOLUTION_PLACEHOLDER = 'Enter resolution details here.';

function descriptionToBlocks(raw: unknown): Record<string, any>[] {
  if (Array.isArray(raw)) {
    return raw.filter((b) => b && typeof b === 'object' && typeof (b as any).type === 'string');
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return descriptionToBlocks(parsed);
      } catch {
        // not JSON: fall through to plain text
      }
    }
    return [textParagraph(raw)];
  }
  return [];
}

/**
 * Builds the BlockNote body for an article created from a ticket. The ticket's
 * real description lives in tickets.attributes.description (BlockNote JSON or
 * plain text) and is spliced under "Problem" with its formatting kept.
 */
export function buildKbArticleContentFromTicket(ticket: {
  attributes?: Record<string, any> | string | null;
}): Record<string, any>[] {
  let attributes: any = ticket.attributes;
  if (typeof attributes === 'string') {
    try {
      attributes = JSON.parse(attributes);
    } catch {
      attributes = null;
    }
  }
  const problem = descriptionToBlocks(attributes?.description);

  return [
    heading('Problem'),
    ...(problem.length > 0 ? problem : [textParagraph(KB_TICKET_PROBLEM_PLACEHOLDER)]),
    heading('Resolution'),
    textParagraph(KB_TICKET_RESOLUTION_PLACEHOLDER),
  ];
}

export function generateKbArticleSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 100);
}

/**
 * Announces a created article to the search indexer. Callers invoke this after
 * their transaction commits — publishing inside the transaction would emit a
 * ghost event for an article a later rollback erases.
 */
export async function publishKbArticleCreated(
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
 * Creates a KB article and its underlying document. Callers are responsible for
 * authorization — this runs with whatever connection/tenant it is handed — and
 * for running it inside a transaction (a failed article insert must roll back the
 * document and block rows) and for calling publishKbArticleCreated once their transaction has committed.
 */
export async function createKbArticle(
  knex: Knex | Knex.Transaction,
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
    is_client_visible: false,
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

  // Callers own the transaction, so a failed insert here rolls the document back too.
  const articleId = randomUUID();
  const nextReviewDue = input.reviewCycleDays
    ? new Date(Date.now() + input.reviewCycleDays * 24 * 60 * 60 * 1000)
    : null;

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

  const article = await tenantScopedTable(knex, 'kb_articles', tenant)
    .select(KB_ARTICLE_SELECT_COLUMNS)
    .where({ article_id: articleId })
    .first();

  return {
    ...article,
    document,
    document_name: document.document_name,
  } as unknown as IKBArticleWithDocument;
}
