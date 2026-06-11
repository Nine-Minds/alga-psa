import type { ZodTypeAny } from 'zod';
import { ApiOpenApiRegistry, zOpenApi } from '../registry';

/**
 * Knowledge Base article routes. All endpoints authenticate via the API key and
 * are tenant-scoped; RBAC is checked against the `document` resource (KB
 * articles are backed by documents).
 */
export function registerKbArticleRoutes(
  registry: ApiOpenApiRegistry,
  deps: { ErrorResponse: ZodTypeAny },
) {
  const tag = 'Knowledge Base';
  const articleType = zOpenApi.enum(['how_to', 'faq', 'troubleshooting', 'reference']);
  const audience = zOpenApi.enum(['internal', 'client', 'public']);
  const status = zOpenApi.enum(['draft', 'review', 'published', 'archived']);

  const KbArticle = registry.registerSchema(
    'KbArticle',
    zOpenApi
      .object({
        article_id: zOpenApi.string().uuid(),
        tenant: zOpenApi.string().uuid(),
        document_id: zOpenApi.string().uuid().describe('Underlying document backing the article.'),
        title: zOpenApi.string(),
        slug: zOpenApi.string(),
        article_type: articleType,
        audience,
        status,
        category_id: zOpenApi.string().uuid().nullable().optional(),
        review_cycle_days: zOpenApi.number().int().nullable().optional(),
        next_review_date: zOpenApi.string().nullable().optional(),
        published_at: zOpenApi.string().nullable().optional(),
        published_by: zOpenApi.string().uuid().nullable().optional(),
        document_name: zOpenApi.string().nullable().optional().describe('Joined from the documents table.'),
        created_at: zOpenApi.string().optional(),
        updated_at: zOpenApi.string().optional(),
      })
      .describe('A knowledge base article and its metadata.'),
  );

  const KbArticleIdParam = registry.registerSchema(
    'KbArticleIdParam',
    zOpenApi.object({ id: zOpenApi.string().uuid().describe('KB article UUID.') }),
  );

  const KbArticleFromTicketParam = registry.registerSchema(
    'KbArticleFromTicketParam',
    zOpenApi.object({ ticketId: zOpenApi.string().uuid().describe('Source ticket UUID.') }),
  );

  const KbArticleCreateRequest = registry.registerSchema(
    'KbArticleCreateRequest',
    zOpenApi.object({
      title: zOpenApi.string().min(1).max(255),
      slug: zOpenApi.string().optional().describe('Optional; generated from the title when omitted.'),
      article_type: articleType.optional().describe('Defaults to how_to.'),
      audience: audience.optional().describe('Defaults to internal.'),
      category_id: zOpenApi.string().uuid().optional(),
      review_cycle_days: zOpenApi.number().int().optional(),
      content: zOpenApi.string().optional().describe('Initial body content.'),
      content_format: zOpenApi.enum(['markdown', 'blocknote']).optional().describe('Defaults to markdown.'),
    }),
  );

  const KbArticleUpdateRequest = registry.registerSchema(
    'KbArticleUpdateRequest',
    zOpenApi.object({
      title: zOpenApi.string().min(1).max(255).optional(),
      slug: zOpenApi.string().optional(),
      article_type: articleType.optional(),
      audience: audience.optional(),
      category_id: zOpenApi.string().uuid().optional(),
      review_cycle_days: zOpenApi.number().int().optional(),
      status: status.optional(),
    }),
  );

  const KbArticleContentUpdateRequest = registry.registerSchema(
    'KbArticleContentUpdateRequest',
    zOpenApi.object({
      content: zOpenApi.string().min(1),
      format: zOpenApi.enum(['markdown', 'blocknote']).optional().describe('Defaults to markdown.'),
    }),
  );

  const KbArticleListQuery = registry.registerSchema(
    'KbArticleListQuery',
    zOpenApi.object({
      page: zOpenApi.number().int().min(1).optional(),
      limit: zOpenApi.number().int().min(1).max(100).optional(),
      status: status.optional(),
      audience: audience.optional(),
      article_type: articleType.optional(),
      category_id: zOpenApi.string().uuid().optional(),
      search: zOpenApi.string().optional(),
    }),
  );

  const KbArticleResponse = registry.registerSchema(
    'KbArticleResponse',
    zOpenApi.object({ data: KbArticle, meta: zOpenApi.record(zOpenApi.unknown()).optional() }),
  );

  const PaginatedKbArticleResponse = registry.registerSchema(
    'PaginatedKbArticleResponse',
    zOpenApi.object({
      data: zOpenApi.array(KbArticle),
      pagination: zOpenApi.object({
        page: zOpenApi.number().int(),
        limit: zOpenApi.number().int(),
        total: zOpenApi.number().int(),
        totalPages: zOpenApi.number().int(),
        hasNext: zOpenApi.boolean(),
        hasPrev: zOpenApi.boolean(),
      }),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const KbCategoryListResponse = registry.registerSchema(
    'KbCategoryListResponse',
    zOpenApi.object({
      data: zOpenApi.array(zOpenApi.object({
        category_id: zOpenApi.string().uuid(),
        category_name: zOpenApi.string(),
        display_order: zOpenApi.number().int().optional(),
      })),
    }),
  );

  const KbTemplateListResponse = registry.registerSchema(
    'KbTemplateListResponse',
    zOpenApi.object({
      data: zOpenApi.array(zOpenApi.object({
        template_id: zOpenApi.string().uuid(),
        name: zOpenApi.string(),
        article_type: articleType.optional(),
      })),
    }),
  );

  const KbArticleContentResponse = registry.registerSchema(
    'KbArticleContentResponse',
    zOpenApi.object({
      data: zOpenApi.object({
        article_id: zOpenApi.string().uuid().optional(),
        content: zOpenApi.string().describe('Article body rendered as readable text.'),
      }),
    }),
  );

  const errs = (extra?: Record<number, string>) => ({
    400: { description: 'Invalid request.', schema: deps.ErrorResponse },
    401: { description: 'API key missing/invalid.', schema: deps.ErrorResponse },
    403: { description: 'Caller lacks the required document permission.', schema: deps.ErrorResponse },
    ...(extra ? Object.fromEntries(Object.entries(extra).map(([code, d]) => [Number(code), { description: d, schema: deps.ErrorResponse }])) : {}),
    500: { description: 'Unexpected error.', schema: deps.ErrorResponse },
  });

  const ext = (action: string) => ({ 'x-tenant-scoped': true, 'x-rbac-resource': 'document', 'x-rbac-action': action });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/kb-articles',
    summary: 'List knowledge base articles',
    description: 'Returns a paginated list of KB articles for the tenant, with optional status, audience, article_type, category_id, and free-text search filters. Each row includes the joined document name.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: KbArticleListQuery },
    responses: { 200: { description: 'Paginated KB articles.', schema: PaginatedKbArticleResponse }, ...errs() },
    extensions: ext('read'),
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/kb-articles',
    summary: 'Create a knowledge base article',
    description: 'Creates a KB article: generates a unique slug, creates the backing document record, and optionally stores initial block content. Returns the created article.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: KbArticleCreateRequest } },
    responses: { 201: { description: 'Article created.', schema: KbArticleResponse }, ...errs() },
    extensions: ext('create'),
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/kb-articles/categories',
    summary: 'List KB article categories',
    description: 'Returns the standard categories available for KB articles, ordered by display order then name.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    responses: { 200: { description: 'Available categories.', schema: KbCategoryListResponse }, ...errs() },
    extensions: ext('read'),
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/kb-articles/templates',
    summary: 'List KB article templates',
    description: 'Returns KB article templates for the tenant, optionally filtered by the article_type query parameter, ordered by name.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: zOpenApi.object({ article_type: articleType.optional() }) },
    responses: { 200: { description: 'Available templates.', schema: KbTemplateListResponse }, ...errs() },
    extensions: ext('read'),
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/kb-articles/from-ticket/{ticketId}',
    summary: 'Create a KB article from a ticket',
    description: 'Creates a troubleshooting KB article (audience internal) from an existing ticket, seeding the body with the ticket title/description as a "Problem" section and the resolution as a "Resolution" section.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: KbArticleFromTicketParam },
    responses: { 201: { description: 'Article created from the ticket.', schema: KbArticleResponse }, ...errs({ 404: 'Ticket not found.' }) },
    extensions: ext('create'),
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/kb-articles/{id}',
    summary: 'Get a knowledge base article',
    description: 'Returns a single KB article by id with its metadata, joined document name, and block content.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: KbArticleIdParam },
    responses: { 200: { description: 'The KB article.', schema: KbArticleResponse }, ...errs({ 404: 'Article not found.' }) },
    extensions: ext('read'),
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/kb-articles/{id}',
    summary: 'Update a knowledge base article',
    description: 'Updates article metadata (title, slug, type, audience, category, status, review cycle). Validates slug uniqueness, syncs the linked document name when the title changes, and recomputes the next review date when the review cycle changes.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: KbArticleIdParam, body: { schema: KbArticleUpdateRequest } },
    responses: { 200: { description: 'Updated article.', schema: KbArticleResponse }, ...errs({ 404: 'Article not found.' }) },
    extensions: ext('update'),
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/kb-articles/{id}',
    summary: 'Delete a knowledge base article',
    description: 'Deletes the KB article and cascades to remove the linked document and its block content.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: KbArticleIdParam },
    responses: { 204: { description: 'Article deleted.', emptyBody: true }, ...errs({ 404: 'Article not found.' }) },
    extensions: ext('delete'),
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/kb-articles/{id}/archive',
    summary: 'Archive a knowledge base article',
    description: 'Sets the article status to archived and clears client visibility on the linked document. Returns the updated article.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: KbArticleIdParam },
    responses: { 200: { description: 'Article archived.', schema: KbArticleResponse }, ...errs({ 404: 'Article not found.' }) },
    extensions: ext('update'),
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/kb-articles/{id}/content',
    summary: 'Get KB article content as text',
    description: 'Returns the article body converted from its stored block (BlockNote) content into readable markdown-like text (headings, lists, code blocks, paragraphs).',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: KbArticleIdParam },
    responses: { 200: { description: 'Rendered article content.', schema: KbArticleContentResponse }, ...errs({ 404: 'Article not found.' }) },
    extensions: ext('read'),
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/kb-articles/{id}/content',
    summary: 'Update KB article content',
    description: 'Replaces the article body. Accepts markdown or BlockNote JSON (format field), parses it into block content, and creates or updates the document block-content record.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: KbArticleIdParam, body: { schema: KbArticleContentUpdateRequest } },
    responses: { 200: { description: 'Content updated.', schema: KbArticleResponse }, ...errs({ 404: 'Article not found.' }) },
    extensions: ext('update'),
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/kb-articles/{id}/publish',
    summary: 'Publish a knowledge base article',
    description: 'Sets the article status to published, records the publish timestamp and user, and sets is_client_visible on the linked document when the audience is client or public. Returns the updated article.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: KbArticleIdParam },
    responses: { 200: { description: 'Article published.', schema: KbArticleResponse }, ...errs({ 404: 'Article not found.' }) },
    extensions: ext('update'),
    edition: 'both',
  });
}
