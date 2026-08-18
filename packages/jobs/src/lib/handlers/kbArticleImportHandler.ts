import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { createKbArticle } from '@alga-psa/shared/models/kbArticleModel';
import type { Knex } from 'knex';
import type { BaseJobData } from '../jobs/interfaces';
import {
  KbImportParseTimeoutError,
  fileContentToBlocks,
  titleFromFilename,
} from '../handler-utils/kbImportBlocks';

/**
 * KB article import.
 *
 * The server action stages uploaded files in kb_import_files and enqueues this
 * job; parsing (previously a quadratic regex pass inside the server action)
 * runs here instead of on a web request. Rows are consumed idempotently — only
 * 'pending' rows are picked up — so a retry never double-creates articles.
 */
export const KB_ARTICLE_IMPORT_JOB = 'kb-article-import';

/** Per-file cooperative parse cap. A single file can never wedge the batch. */
export const KB_IMPORT_PARSE_BUDGET_MS = 60_000;

export interface KbArticleImportJobData extends BaseJobData {
  tenantId: string;
  userId: string;
  jobServiceId?: string;
  fileIds: string[];
}

export interface KbArticleImportResult extends Record<string, unknown> {
  total: number;
  processed: number;
  imported: number;
  failed: number;
}

interface KbImportFileRow {
  import_file_id: string;
  filename: string;
  content: string | null;
  status: string;
  audience: string | null;
  article_type: string | null;
  category_id: string | null;
}

const TITLE_REQUIRED = 'Title is required';
const SLUG_TAKEN = 'An article with this slug already exists';

export function kbImportErrorMessage(error: unknown): string {
  if (error instanceof KbImportParseTimeoutError) {
    return 'File is too large or complex to import';
  }

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (message === TITLE_REQUIRED || message === SLUG_TAKEN) {
    return message;
  }

  return 'Failed to import article';
}

async function updateJobProgress(
  knex: Knex,
  tenant: string,
  jobRecordId: string,
  progress: KbArticleImportResult,
): Promise<void> {
  // Progress is bookkeeping: the import must never fail because the job row
  // could not be updated.
  try {
    const job = await tenantDb(knex, tenant).table('jobs').where({ job_id: jobRecordId }).first();
    if (!job) return;

    const metadata = job.metadata
      ? (typeof job.metadata === 'string' ? JSON.parse(job.metadata) : job.metadata)
      : {};

    await tenantDb(knex, tenant)
      .table('jobs')
      .where({ job_id: jobRecordId })
      .update({
        metadata: JSON.stringify({ ...metadata, kbImport: progress }),
        updated_at: new Date(),
      });
  } catch (error) {
    logger.warn('[kbArticleImport] Failed to record import progress', {
      jobRecordId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function kbArticleImportHandler(
  jobId: string,
  data: KbArticleImportJobData,
): Promise<KbArticleImportResult> {
  if (!data?.tenantId) {
    throw new Error('Tenant ID is required');
  }
  if (!data.userId) {
    throw new Error('User ID is required');
  }
  const fileIds = Array.isArray(data.fileIds) ? data.fileIds.filter(Boolean) : [];
  if (fileIds.length === 0) {
    throw new Error('At least one import file is required');
  }

  const { knex, tenant: resolvedTenant } = await createTenantKnex(data.tenantId);
  const tenant = resolvedTenant ?? data.tenantId;
  const jobRecordId = data.jobServiceId || jobId;
  const progress: KbArticleImportResult = {
    total: fileIds.length,
    processed: 0,
    imported: 0,
    failed: 0,
  };

  for (const fileId of fileIds) {
    // Loaded one at a time: a batch of multi-megabyte files must not all sit
    // in memory at once.
    const row = (await tenantDb(knex, tenant)
      .table('kb_import_files')
      .where({ import_file_id: fileId })
      .first()) as KbImportFileRow | undefined;

    if (!row) {
      logger.warn('[kbArticleImport] Staged import file not found', { fileId, tenant });
      progress.processed += 1;
      progress.failed += 1;
      await updateJobProgress(knex, tenant, jobRecordId, progress);
      continue;
    }

    if (row.status !== 'pending') {
      // Already consumed by an earlier attempt.
      progress.processed += 1;
      if (row.status === 'imported') progress.imported += 1;
      else progress.failed += 1;
      continue;
    }

    try {
      const title = titleFromFilename(row.filename);
      const blocks = fileContentToBlocks(row.filename, row.content ?? '', {
        maxDurationMs: KB_IMPORT_PARSE_BUDGET_MS,
      });

      const article = await createKbArticle(
        knex,
        { tenant, userId: data.userId },
        {
          title,
          content: blocks,
          articleType: (row.article_type as any) || 'reference',
          audience: (row.audience as any) || 'internal',
          categoryId: row.category_id || undefined,
        },
      );

      await tenantDb(knex, tenant)
        .table('kb_import_files')
        .where({ import_file_id: fileId })
        .update({
          status: 'imported',
          article_id: article.article_id,
          error: null,
          content: null, // terminal rows keep the staging table lean
          updated_at: new Date(),
        });

      progress.imported += 1;
    } catch (error) {
      logger.error('[kbArticleImport] Failed to import staged file', {
        fileId,
        tenant,
        filename: row.filename,
        error: error instanceof Error ? error.message : String(error),
      });

      await tenantDb(knex, tenant)
        .table('kb_import_files')
        .where({ import_file_id: fileId })
        .update({
          status: 'failed',
          error: kbImportErrorMessage(error),
          content: null,
          updated_at: new Date(),
        });

      progress.failed += 1;
    }

    progress.processed += 1;
    await updateJobProgress(knex, tenant, jobRecordId, progress);
  }

  logger.info('[kbArticleImport] Import job finished', {
    jobId: jobRecordId,
    tenant,
    ...progress,
  });

  return progress;
}
