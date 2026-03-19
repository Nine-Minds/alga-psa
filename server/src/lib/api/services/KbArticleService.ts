/**
 * KB Article Service
 * Business logic for knowledge base article API operations
 */

import { randomUUID } from 'crypto';
import { BaseService, ServiceContext, ListResult } from '@alga-psa/db';
import { ListOptions } from '../controllers/types';
import { NotFoundError } from '../middleware/apiMiddleware';
import type { CreateKbArticleData, UpdateKbArticleData, UpdateKbArticleContentData } from '../schemas/kbArticle';

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

interface BlockNoteBlock {
  type: string;
  props?: Record<string, any>;
  content?: any[];
  children?: BlockNoteBlock[];
}

/**
 * Convert markdown text to BlockNote JSON blocks.
 * Handles headings, code blocks, lists, and paragraphs.
 */
function markdownToBlocks(markdown: string): BlockNoteBlock[] {
  const lines = markdown.split('\n');
  const blocks: BlockNoteBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: 'codeBlock',
        props: { language: lang || 'text' },
        content: [{ type: 'text', text: codeLines.join('\n'), styles: {} }],
      });
      i++; // skip closing ```
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        props: { level: headingMatch[1].length },
        content: [{ type: 'text', text: headingMatch[2].trim(), styles: {} }],
      });
      i++;
      continue;
    }

    // Unordered list items
    if (/^\s*[-*+]\s+/.test(line)) {
      const text = line.replace(/^\s*[-*+]\s+/, '');
      blocks.push({
        type: 'bulletListItem',
        content: [{ type: 'text', text, styles: {} }],
      });
      i++;
      continue;
    }

    // Ordered list items
    if (/^\s*\d+\.\s+/.test(line)) {
      const text = line.replace(/^\s*\d+\.\s+/, '');
      blocks.push({
        type: 'numberedListItem',
        content: [{ type: 'text', text, styles: {} }],
      });
      i++;
      continue;
    }

    // Skip blank lines
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraphs
    blocks.push({
      type: 'paragraph',
      content: [{ type: 'text', text: line, styles: {} }],
    });
    i++;
  }

  return blocks;
}

/**
 * Extract readable text from BlockNote JSON blocks.
 */
function blocksToText(blocks: BlockNoteBlock[]): string {
  const lines: string[] = [];

  for (const block of blocks) {
    const text = (block.content || [])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('');

    switch (block.type) {
      case 'heading':
        lines.push(`${'#'.repeat(block.props?.level || 1)} ${text}`);
        break;
      case 'bulletListItem':
        lines.push(`- ${text}`);
        break;
      case 'numberedListItem':
        lines.push(`1. ${text}`);
        break;
      case 'codeBlock':
        lines.push(`\`\`\`${block.props?.language || ''}`);
        lines.push(text);
        lines.push('```');
        break;
      default:
        if (text) lines.push(text);
        break;
    }

    if (block.children && block.children.length > 0) {
      lines.push(blocksToText(block.children));
    }
  }

  return lines.join('\n');
}

export class KbArticleService extends BaseService<any> {
  constructor() {
    super({
      tableName: 'kb_articles',
      primaryKey: 'article_id',
      tenantColumn: 'tenant',
      searchableFields: ['slug'],
      defaultSort: 'created_at',
      defaultOrder: 'desc',
    });
  }

  async list(options: ListOptions, context: ServiceContext): Promise<ListResult<any>> {
    const { knex } = await this.getKnex();
    const {
      page = 1,
      limit = 25,
      filters = {},
      sort,
      order,
    } = options;

    let dataQuery = knex('kb_articles as ka')
      .select([
        ...KB_ARTICLE_SELECT_COLUMNS.map((col) => `ka.${col}`),
        'd.document_name',
      ])
      .leftJoin('documents as d', function () {
        this.on('d.document_id', '=', 'ka.document_id').andOn('d.tenant', '=', 'ka.tenant');
      })
      .where('ka.tenant', context.tenant);

    let countQuery = knex('kb_articles')
      .where('tenant', context.tenant);

    // Apply filters
    if (filters.status) {
      dataQuery = dataQuery.where('ka.status', filters.status);
      countQuery = countQuery.where('status', filters.status);
    }
    if (filters.audience) {
      dataQuery = dataQuery.where('ka.audience', filters.audience);
      countQuery = countQuery.where('audience', filters.audience);
    }
    if (filters.article_type) {
      dataQuery = dataQuery.where('ka.article_type', filters.article_type);
      countQuery = countQuery.where('article_type', filters.article_type);
    }
    if (filters.category_id) {
      dataQuery = dataQuery.where('ka.category_id', filters.category_id);
      countQuery = countQuery.where('category_id', filters.category_id);
    }
    if (filters.search) {
      const term = `%${filters.search}%`;
      dataQuery = dataQuery.where(function () {
        this.whereILike('d.document_name', term).orWhereILike('ka.slug', term);
      });
      countQuery = countQuery.whereExists(function () {
        this.select('*')
          .from('documents as d2')
          .whereRaw('d2.document_id = kb_articles.document_id')
          .andWhereRaw('d2.tenant = kb_articles.tenant')
          .andWhere(function () {
            this.whereILike('d2.document_name', term);
          });
      });
    }

    // Sorting
    const sortField = sort || this.defaultSort;
    const sortOrder = order || this.defaultOrder;
    dataQuery = dataQuery.orderBy(`ka.${sortField}`, sortOrder);

    // Pagination
    const offset = (page - 1) * limit;
    dataQuery = dataQuery.limit(limit).offset(offset);

    const [articles, [{ count }]] = await Promise.all([
      dataQuery,
      countQuery.count('* as count'),
    ]);

    return {
      data: articles,
      total: parseInt(count as string),
    };
  }

  async getById(id: string, context: ServiceContext): Promise<any | null> {
    const { knex } = await this.getKnex();

    const article = await knex('kb_articles as ka')
      .select([
        ...KB_ARTICLE_SELECT_COLUMNS.map((col) => `ka.${col}`),
        'd.document_name',
        'dbc.block_data',
      ])
      .leftJoin('documents as d', function () {
        this.on('d.document_id', '=', 'ka.document_id').andOn('d.tenant', '=', 'ka.tenant');
      })
      .leftJoin('document_block_content as dbc', function () {
        this.on('dbc.document_id', '=', 'ka.document_id').andOn('dbc.tenant', '=', 'ka.tenant');
      })
      .where('ka.tenant', context.tenant)
      .andWhere('ka.article_id', id)
      .first();

    return article || null;
  }

  async create(data: CreateKbArticleData, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();

    if (!data.title?.trim()) {
      throw new Error('Title is required');
    }

    let slug = data.slug?.trim() || generateSlug(data.title);
    const articleType = data.article_type || 'how_to';
    const audience = data.audience || 'internal';

    // Ensure slug uniqueness
    const existingSlug = await knex('kb_articles').where({ tenant: context.tenant, slug }).first();
    if (existingSlug) {
      if (data.slug?.trim()) {
        throw new Error('An article with this slug already exists');
      }
      let suffix = 2;
      while (true) {
        const candidate = `${slug}-${suffix}`;
        const collision = await knex('kb_articles').where({ tenant: context.tenant, slug: candidate }).first();
        if (!collision) {
          slug = candidate;
          break;
        }
        suffix++;
      }
    }

    // Create underlying document
    const documentId = randomUUID();
    const now = new Date();

    await knex('documents').insert({
      tenant: context.tenant,
      document_id: documentId,
      document_name: data.title.trim(),
      user_id: context.userId,
      created_by: context.userId,
      order_number: 0,
      folder_path: '/Knowledge Base',
      entered_at: now,
      updated_at: now,
    });

    // Store block content if provided
    if (data.content) {
      let blocks: BlockNoteBlock[];
      if (data.content_format === 'blocknote') {
        blocks = JSON.parse(data.content);
      } else {
        blocks = markdownToBlocks(data.content);
      }

      if (blocks.length > 0) {
        await knex('document_block_content').insert({
          content_id: randomUUID(),
          document_id: documentId,
          tenant: context.tenant,
          block_data: JSON.stringify(blocks),
          created_at: now,
          updated_at: now,
        });
      }
    }

    // Create KB article record
    const articleId = randomUUID();
    const nextReviewDue = data.review_cycle_days
      ? new Date(Date.now() + data.review_cycle_days * 24 * 60 * 60 * 1000)
      : null;

    try {
      await knex('kb_articles').insert({
        tenant: context.tenant,
        article_id: articleId,
        document_id: documentId,
        slug,
        article_type: articleType,
        audience,
        status: 'draft',
        review_cycle_days: data.review_cycle_days || null,
        next_review_due: nextReviewDue,
        category_id: data.category_id || null,
        created_by: context.userId,
        updated_by: context.userId,
      });
    } catch (err) {
      await knex('documents')
        .where({ tenant: context.tenant, document_id: documentId })
        .del()
        .catch(() => {});
      throw err;
    }

    return this.getById(articleId, context);
  }

  async update(id: string, data: UpdateKbArticleData, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();

    const existing = await knex('kb_articles')
      .where({ tenant: context.tenant, article_id: id })
      .first();

    if (!existing) {
      throw new NotFoundError('Article not found');
    }

    const updates: Record<string, any> = {
      updated_at: knex.fn.now(),
      updated_by: context.userId,
    };

    if (data.title !== undefined) {
      await knex('documents')
        .where({ tenant: context.tenant, document_id: existing.document_id })
        .update({ document_name: data.title.trim(), updated_at: knex.fn.now() });
    }

    if (data.slug !== undefined) {
      const newSlug = data.slug.trim();
      const collision = await knex('kb_articles')
        .where({ tenant: context.tenant, slug: newSlug })
        .whereNot('article_id', id)
        .first();
      if (collision) {
        throw new Error('An article with this slug already exists');
      }
      updates.slug = newSlug;
    }

    if (data.article_type !== undefined) updates.article_type = data.article_type;
    if (data.audience !== undefined) updates.audience = data.audience;
    if (data.category_id !== undefined) updates.category_id = data.category_id;
    if (data.status !== undefined) updates.status = data.status;

    if (data.review_cycle_days !== undefined) {
      updates.review_cycle_days = data.review_cycle_days;
      if (data.review_cycle_days) {
        updates.next_review_due = new Date(Date.now() + data.review_cycle_days * 24 * 60 * 60 * 1000);
      }
    }

    await knex('kb_articles')
      .where({ tenant: context.tenant, article_id: id })
      .update(updates);

    return this.getById(id, context);
  }

  async delete(id: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();

    const article = await knex('kb_articles')
      .where({ tenant: context.tenant, article_id: id })
      .first();

    if (!article) {
      throw new NotFoundError('Article not found');
    }

    // Delete article, then associated document
    await knex('kb_articles')
      .where({ tenant: context.tenant, article_id: id })
      .del();

    await knex('document_block_content')
      .where({ tenant: context.tenant, document_id: article.document_id })
      .del()
      .catch(() => {});

    await knex('documents')
      .where({ tenant: context.tenant, document_id: article.document_id })
      .del()
      .catch(() => {});
  }

  async publish(id: string, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();

    const article = await knex('kb_articles')
      .where({ tenant: context.tenant, article_id: id })
      .first();

    if (!article) {
      throw new NotFoundError('Article not found');
    }

    const now = knex.fn.now();
    await knex('kb_articles')
      .where({ tenant: context.tenant, article_id: id })
      .update({
        status: 'published',
        published_at: now,
        published_by: context.userId,
        updated_at: now,
        updated_by: context.userId,
      });

    // Auto-set client visibility for client/public audience
    if (article.audience === 'client' || article.audience === 'public') {
      await knex('documents')
        .where({ tenant: context.tenant, document_id: article.document_id })
        .update({ is_client_visible: true, updated_at: now });
    }

    return this.getById(id, context);
  }

  async archive(id: string, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();

    const article = await knex('kb_articles')
      .where({ tenant: context.tenant, article_id: id })
      .first();

    if (!article) {
      throw new NotFoundError('Article not found');
    }

    const now = knex.fn.now();
    await knex('kb_articles')
      .where({ tenant: context.tenant, article_id: id })
      .update({
        status: 'archived',
        updated_at: now,
        updated_by: context.userId,
      });

    // Clear client visibility
    await knex('documents')
      .where({ tenant: context.tenant, document_id: article.document_id })
      .update({ is_client_visible: false, updated_at: now });

    return this.getById(id, context);
  }

  async getContent(id: string, context: ServiceContext): Promise<{ content: string; format: string } | null> {
    const { knex } = await this.getKnex();

    const article = await knex('kb_articles as ka')
      .select('dbc.block_data')
      .leftJoin('document_block_content as dbc', function () {
        this.on('dbc.document_id', '=', 'ka.document_id').andOn('dbc.tenant', '=', 'ka.tenant');
      })
      .where('ka.tenant', context.tenant)
      .andWhere('ka.article_id', id)
      .first();

    if (!article) {
      return null;
    }

    if (!article.block_data) {
      return { content: '', format: 'markdown' };
    }

    const blocks = typeof article.block_data === 'string'
      ? JSON.parse(article.block_data)
      : article.block_data;

    return {
      content: blocksToText(blocks),
      format: 'markdown',
    };
  }

  async updateContent(id: string, data: UpdateKbArticleContentData, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();

    const article = await knex('kb_articles')
      .where({ tenant: context.tenant, article_id: id })
      .first();

    if (!article) {
      throw new NotFoundError('Article not found');
    }

    let blocks: BlockNoteBlock[];
    if (data.format === 'blocknote') {
      blocks = JSON.parse(data.content);
    } else {
      blocks = markdownToBlocks(data.content);
    }

    const now = new Date();
    const existing = await knex('document_block_content')
      .where({ tenant: context.tenant, document_id: article.document_id })
      .first();

    if (existing) {
      await knex('document_block_content')
        .where({ tenant: context.tenant, document_id: article.document_id })
        .update({ block_data: JSON.stringify(blocks), updated_at: now });
    } else {
      await knex('document_block_content').insert({
        content_id: randomUUID(),
        document_id: article.document_id,
        tenant: context.tenant,
        block_data: JSON.stringify(blocks),
        created_at: now,
        updated_at: now,
      });
    }

    // Update article timestamp
    await knex('kb_articles')
      .where({ tenant: context.tenant, article_id: id })
      .update({ updated_at: now, updated_by: context.userId });

    return this.getById(id, context);
  }

  async getCategories(context: ServiceContext): Promise<any[]> {
    const { knex } = await this.getKnex();

    return knex('standard_categories')
      .select('id', 'category_name', 'parent_category_uuid', 'display_order')
      .orderBy('display_order', 'asc')
      .orderBy('category_name', 'asc');
  }

  async getTemplates(context: ServiceContext, articleType?: string): Promise<any[]> {
    const { knex } = await this.getKnex();

    let query = knex('kb_article_templates')
      .where('tenant', context.tenant);

    if (articleType) {
      query = query.where('article_type', articleType);
    }

    return query.orderBy('name', 'asc');
  }

  async createFromTicket(ticketId: string, context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();

    const ticket = await knex('tickets')
      .where({ tenant: context.tenant, ticket_id: ticketId })
      .first();

    if (!ticket) {
      throw new NotFoundError('Ticket not found');
    }

    const title = ticket.title || 'Untitled Article';
    const description = ticket.description || '';
    const resolution = ticket.resolution || '';

    // Build BlockNote content from ticket data
    const blocks: BlockNoteBlock[] = [];

    blocks.push({
      type: 'heading',
      props: { level: 2 },
      content: [{ type: 'text', text: 'Problem', styles: {} }],
    });

    if (description) {
      blocks.push({
        type: 'paragraph',
        content: [{ type: 'text', text: description, styles: {} }],
      });
    }

    blocks.push({
      type: 'heading',
      props: { level: 2 },
      content: [{ type: 'text', text: 'Resolution', styles: {} }],
    });

    if (resolution) {
      blocks.push({
        type: 'paragraph',
        content: [{ type: 'text', text: resolution, styles: {} }],
      });
    }

    return this.create({
      title,
      article_type: 'troubleshooting',
      audience: 'internal',
      content: JSON.stringify(blocks),
      content_format: 'blocknote',
    }, context);
  }
}
