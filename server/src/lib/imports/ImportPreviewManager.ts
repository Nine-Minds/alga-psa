import { getConnection } from '@/lib/db/db';
import { ImportValidationError, logImportError } from '@/lib/imports/errors';
import { createImportErrorCollector } from '@/lib/imports/ErrorCollector';
import type {
  ImportErrorSummary,
  ImportJobMetrics,
  ImportPreviewSummary,
  PreviewComputationResult,
  PreviewData,
  PreviewGenerationOptions,
  PreviewRow,
  ParsedRecord,
  DuplicateCheckResult
} from '@/types/imports.types';

const PREVIEW_DEFAULT_LIMIT = 10;

interface AccumulatedError {
  count: number;
  messages: string[];
}

export class ImportPreviewManager {
  private readonly tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  private async ensureTenantContext(): Promise<void> {
    try {
      const knex = await getConnection(this.tenantId);
      await knex.raw("SELECT set_config('app.current_tenant', ?, false)", [this.tenantId]);
    } catch (error) {
      // ignore if parameter not required (e.g., during unit tests)
    }
  }

  async generate(options: PreviewGenerationOptions): Promise<PreviewComputationResult> {
    await this.ensureTenantContext();
    const { records, validator, duplicateDetector, maxPreviewRows } = options;
    const previewLimit = maxPreviewRows ?? PREVIEW_DEFAULT_LIMIT;

    const collector = createImportErrorCollector();
    const previewRows: PreviewRow[] = [];
    let duplicateRows = 0;
    let errorRows = 0;
    let validRows = 0;

    for (const record of records) {
      const validationErrors = await this.runValidators(validator, record);
      if (validationErrors.length > 0) {
        collector.addMany(validationErrors);
        errorRows += 1;
      }

      let duplicateResult: DuplicateCheckResult | null = null;
      if (duplicateDetector) {
        try {
          duplicateResult = await duplicateDetector.check(record);
          if (duplicateResult.isDuplicate) {
            duplicateRows += 1;
          }
        } catch (error) {
          logImportError(error, {
            tenantId: this.tenantId,
            importJobId: options.importJobId,
            rowNumber: record.rowNumber,
          });
        }
      }

      if (validationErrors.length === 0 && !(duplicateResult?.isDuplicate)) {
        validRows += 1;
      }

      if (previewRows.length < previewLimit) {
        previewRows.push({
          rowNumber: record.rowNumber,
          values: record.raw,
          validationErrors: validationErrors.length ? validationErrors : undefined,
          duplicate: duplicateResult ?? null,
        });
      }
    }

    const columnExamples = this.collectColumnExamples(records);

    const preview: PreviewData = {
      rows: previewRows,
      summary: {
        totalRows: records.length,
        validRows,
        duplicateRows,
        errorRows,
      },
      columnExamples: Object.keys(columnExamples).length ? columnExamples : undefined,
    };

    const errorSummary = this.buildErrorSummary(collector.getErrors(), errorRows);
    const metrics: ImportJobMetrics = {
      totalRows: records.length,
      processedRows: 0,
      created: 0,
      updated: 0,
      duplicates: duplicateRows,
      errors: errorRows,
    };

    return {
      preview,
      summary: preview.summary,
      errorSummary,
      metrics,
    };
  }

  async persist(importJobId: string, result: PreviewComputationResult): Promise<void> {
    await this.ensureTenantContext();
    const knex = await getConnection(this.tenantId);
    await knex('import_jobs')
      .where({ tenant: this.tenantId, import_job_id: importJobId })
      .update({
        preview_data: result.preview,
        error_summary: result.errorSummary,
        total_rows: result.summary.totalRows,
        processed_rows: 0,
        created_rows: 0,
        updated_rows: 0,
        duplicate_rows: result.summary.duplicateRows,
        error_rows: result.summary.errorRows,
        status: 'preview',
        updated_at: knex.fn.now(),
      });
  }

  private async runValidators(
    validator: PreviewGenerationOptions['validator'],
    record: ParsedRecord
  ): Promise<ImportValidationError[]> {
    if (!validator) {
      return [];
    }

    try {
      return await validator(record);
    } catch (error) {
      logImportError(error, {
        tenantId: this.tenantId,
        rowNumber: record.rowNumber,
      });
      return [
        new ImportValidationError(
          record.rowNumber,
          '_validator',
          undefined,
          error instanceof Error ? error.message : 'Validation failed'
        ),
      ];
    }
  }

  private buildErrorSummary(
    errors: ImportValidationError[],
    rowsWithErrors: number
  ): ImportErrorSummary | null {
    if (!errors.length) {
      return null;
    }

    const aggregate = new Map<string, AccumulatedError>();
    errors.forEach((error) => {
      const key = error.field ?? '_row';
      const bucket = aggregate.get(key) ?? { count: 0, messages: [] };
      bucket.count += 1;
      if (error.message && bucket.messages.length < 3) {
        bucket.messages.push(error.message);
      }
      aggregate.set(key, bucket);
    });

    const topErrors = Array.from(aggregate.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([field, data]) => ({
        field,
        count: data.count,
        sampleMessage: data.messages[0] ?? 'Validation failed',
      }));

    return {
      totalErrors: errors.length,
      rowsWithErrors,
      topErrors,
    };
  }

  private collectColumnExamples(
    records: ParsedRecord[],
    limit = 3
  ): Record<string, unknown[]> {
    const examples = new Map<string, unknown[]>();

    for (const record of records) {
      for (const [key, value] of Object.entries(record.raw)) {
        if (value === undefined || value === null) {
          continue;
        }

        const trimmed = typeof value === 'string' ? value.trim() : value;
        if (trimmed === '') {
          continue;
        }

        const current = examples.get(key) ?? [];
        if (current.length >= limit) {
          continue;
        }

        if (!current.some((existing) => existing === trimmed)) {
          current.push(trimmed);
          examples.set(key, current);
        }
      }
    }

    const result: Record<string, unknown[]> = {};
    examples.forEach((values, key) => {
      result[key] = values;
    });
    return result;
  }
}
