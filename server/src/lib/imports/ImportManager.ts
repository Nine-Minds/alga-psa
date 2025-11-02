import { Knex as KnexType } from 'knex';
import { getConnection } from '@/lib/db/db';
import { ImportRegistry } from './ImportRegistry';
import { ImportSource } from './ImportSource';
import type {
  DetectionContext,
  DuplicateCheckResult,
  ImportFilters,
  ImportJobDetails,
  ImportJobItemRecord,
  ImportJobRecord,
  ImportJobStatus,
  ImportSourceRecord,
  InitiateImportOptions,
  ParsedRecord,
  PreviewComputationResult,
  PreviewGenerationOptions
} from '@/types/imports.types';
import { AbstractImporter } from './AbstractImporter';
import type { FieldMappingTemplate } from '@/types/imports.types';
import { ImportPreviewManager } from './ImportPreviewManager';
import { FieldMapper } from './FieldMapper';

type ImportJobQuery = KnexType.QueryBuilder<ImportJobRecord, ImportJobRecord[]>;

const toTemplate = (fieldMappings: ReturnType<AbstractImporter['getDefaultFieldMapping']>): FieldMappingTemplate | null => {
  if (!fieldMappings || fieldMappings.length === 0) {
    return null;
  }

  return fieldMappings.reduce<FieldMappingTemplate>((acc, mapping) => {
    acc[mapping.sourceField] = {
      target: mapping.targetField,
      required: mapping.required,
      transformer: mapping.transformer
    };
    return acc;
  }, {});
};

const normaliseStatusFilter = (status?: ImportJobStatus | ImportJobStatus[]): ImportJobStatus[] | undefined => {
  if (!status) {
    return undefined;
  }
  return Array.isArray(status) ? status : [status];
};

/**
 * Orchestrates import source registration, job lifecycle, and basic querying.
 * Phase 1 focuses on persistence and structural concerns.
 */
export class ImportManager {
  private readonly registry: ImportRegistry;

  constructor(registry: ImportRegistry = ImportRegistry.getInstance()) {
    this.registry = registry;
  }

  /**
   * Ensure all registered importer plugins have a persisted representation for the tenant.
   */
  private async ensureImportersRegistered(tenantId: string, knex: KnexType): Promise<void> {
    const existingSources = await knex<ImportSourceRecord>('import_sources')
      .select('source_type')
      .where({ tenant: tenantId });

    const existing = new Set(existingSources.map((row) => row.source_type.toLowerCase()));

    for (const importer of this.registry.list()) {
      if (existing.has(importer.sourceType.toLowerCase())) {
        continue;
      }

      await knex('import_sources').insert({
        tenant: tenantId,
        source_type: importer.sourceType,
        name: importer.name,
        description: importer.description,
        field_mapping: toTemplate(importer.getDefaultFieldMapping()),
        duplicate_detection_fields: null,
        is_active: true,
        metadata: importer.getMetadata() ?? null
      });
    }
  }

  async getAvailableSources(tenantId: string, includeInactive = false): Promise<ImportSource[]> {
    const knex = await getConnection(tenantId);
    await this.ensureImportersRegistered(tenantId, knex);

    const query = knex<ImportSourceRecord>('import_sources')
      .where({ tenant: tenantId })
      .orderBy('name', 'asc');

    if (!includeInactive) {
      query.andWhere('is_active', true);
    }

    const records = await query;
    return records.map(ImportSource.fromRecord);
  }

  async getSourceById(tenantId: string, sourceId: string): Promise<ImportSource | null> {
    const knex = await getConnection(tenantId);
    const record = await knex<ImportSourceRecord>('import_sources')
      .where({
        tenant: tenantId,
        import_source_id: sourceId
      })
      .first();

    return record ? ImportSource.fromRecord(record) : null;
  }

  /**
   * Persist updates to an import source registration.
   */
  async registerSource(source: ImportSource): Promise<ImportSource> {
    const knex = await getConnection(source.tenant);
    const payload = source.toRecord();

    const existing = await knex<ImportSourceRecord>('import_sources')
      .where({
        tenant: payload.tenant,
        import_source_id: payload.import_source_id
      })
      .first();

    if (existing) {
      const [updated] = await knex<ImportSourceRecord>('import_sources')
        .where({
          tenant: payload.tenant,
          import_source_id: payload.import_source_id
        })
        .update({
          source_type: payload.source_type,
          name: payload.name,
          description: payload.description,
          field_mapping: payload.field_mapping,
          duplicate_detection_fields: payload.duplicate_detection_fields,
          is_active: payload.is_active,
          metadata: payload.metadata,
          updated_at: knex.fn.now()
        })
        .returning('*');

      return ImportSource.fromRecord(updated);
    }

    const [created] = await knex<ImportSourceRecord>('import_sources')
      .insert({
        tenant: payload.tenant,
        import_source_id: payload.import_source_id,
        source_type: payload.source_type,
        name: payload.name,
        description: payload.description,
        field_mapping: payload.field_mapping,
        duplicate_detection_fields: payload.duplicate_detection_fields,
        is_active: payload.is_active,
        metadata: payload.metadata,
        created_at: payload.created_at,
        updated_at: payload.updated_at
      })
      .returning('*');

    return ImportSource.fromRecord(created);
  }

  /**
   * Register an AbstractImporter with the in-memory registry.
   */
  registerImporter(importer: AbstractImporter): void {
    this.registry.register(importer);
  }

  async saveFieldMappingTemplate(
    tenantId: string,
    importSourceId: string,
    template: FieldMappingTemplate
  ): Promise<FieldMappingTemplate | null> {
    const knex = await getConnection(tenantId);
    const [updated] = await knex<ImportSourceRecord>('import_sources')
      .where({ tenant: tenantId, import_source_id: importSourceId })
      .update({ field_mapping: template, updated_at: knex.fn.now() })
      .returning('*');

    return updated?.field_mapping ?? null;
  }

  async getFieldMappingTemplate(
    tenantId: string,
    importSourceId: string
  ): Promise<FieldMappingTemplate | null> {
    const knex = await getConnection(tenantId);
    const record = await knex<ImportSourceRecord>('import_sources')
      .select('field_mapping')
      .where({ tenant: tenantId, import_source_id: importSourceId })
      .first();

    return record?.field_mapping ?? null;
  }

  /**
   * Initialise a new import job in preview state.
   */
  async initiateImport(
    tenantId: string,
    importSourceId: string,
    options: InitiateImportOptions
  ): Promise<ImportJobRecord> {
    const knex = await getConnection(tenantId);

    const [job] = await knex<ImportJobRecord>('import_jobs')
      .insert({
        tenant: tenantId,
        import_source_id: importSourceId,
        status: 'preview' satisfies ImportJobStatus,
        file_name: options.file.fileName,
        total_rows: options.totalRows ?? 0,
        processed_rows: 0,
        created_rows: 0,
        updated_rows: 0,
        duplicate_rows: 0,
        error_rows: 0,
        preview_data: options.previewData ?? null,
        error_summary: null,
        context: options.context ?? null,
        created_by: options.createdBy
      })
      .returning('*');

    return job;
  }

  async getPreview(tenantId: string, importJobId: string): Promise<ImportJobRecord['preview_data']> {
    const knex = await getConnection(tenantId);
    const job = await knex<ImportJobRecord>('import_jobs')
      .select('preview_data')
      .where({ tenant: tenantId, import_job_id: importJobId })
      .first();
    return job?.preview_data ?? null;
  }

  /**
   * Transition job to processing state. Integration with job system occurs in later phases.
   */
  async executeImport(tenantId: string, importJobId: string): Promise<ImportJobRecord | null> {
    const knex = await getConnection(tenantId);
    const [job] = await knex<ImportJobRecord>('import_jobs')
      .where({ tenant: tenantId, import_job_id: importJobId })
      .update({
        status: 'processing',
        updated_at: knex.fn.now()
      })
      .returning('*');

    return job ?? null;
  }

  async getImportStatus(tenantId: string, importJobId: string): Promise<ImportJobRecord | null> {
    const knex = await getConnection(tenantId);
    const job = await knex<ImportJobRecord>('import_jobs')
      .where({ tenant: tenantId, import_job_id: importJobId })
      .first();
    return job ?? null;
  }

  async getImportHistory(tenantId: string, filters: ImportFilters = {}): Promise<ImportJobRecord[]> {
    const knex = await getConnection(tenantId);
    let query: ImportJobQuery = knex<ImportJobRecord>('import_jobs')
      .where({ tenant: tenantId })
      .orderBy('created_at', 'desc');

    const statuses = normaliseStatusFilter(filters.status);
    if (statuses && statuses.length > 0) {
      query = query.whereIn('status', statuses);
    }

    if (filters.createdBy) {
      query = query.andWhere('created_by', filters.createdBy);
    }

    if (filters.sourceType) {
      query = query.whereIn(
        'import_source_id',
        knex('import_sources')
          .select('import_source_id')
          .where({
            tenant: tenantId,
            source_type: filters.sourceType
          })
      );
    }

    if (filters.from) {
      query = query.andWhere('created_at', '>=', filters.from);
    }

    if (filters.to) {
      query = query.andWhere('created_at', '<=', filters.to);
    }

    if (filters.search) {
      query = query.andWhere((builder) => {
        builder
          .whereILike('file_name', `%${filters.search}%`);
      });
    }

    const results = await query;
    return results;
  }

  async getImportDetails(tenantId: string, importJobId: string): Promise<ImportJobDetails | null> {
    const knex = await getConnection(tenantId);
    const job = await knex<ImportJobRecord>('import_jobs')
      .where({ tenant: tenantId, import_job_id: importJobId })
      .first();

    if (!job) {
      return null;
    }

    const items = await knex<ImportJobItemRecord>('import_job_items')
      .where({ tenant: tenantId, import_job_id: importJobId })
      .orderBy('created_at', 'asc');

    const metrics = {
      totalRows: job.total_rows,
      processedRows: job.processed_rows,
      created: job.created_rows,
      updated: job.updated_rows,
      duplicates: job.duplicate_rows,
      errors: job.error_rows
    };

    return {
      ...job,
      items,
      metrics
    };
  }

  /**
   * Convenience helper for running duplicate detection using either importer override or default strategy.
   */
  async detectDuplicate(
    tenantId: string,
    importJobId: string,
    record: ParsedRecord,
    context: DetectionContext
  ): Promise<DuplicateCheckResult> {
    const job = await this.getImportStatus(tenantId, importJobId);
    if (!job) {
      return { isDuplicate: false };
    }

    const sourceId = job.import_source_id ?? context.importSourceId;

    const source = await this.getSourceById(tenantId, sourceId);
    if (!source) {
      return { isDuplicate: false };
    }

    const importer = this.registry.get(source.sourceType);
    if (!importer) {
      return { isDuplicate: false };
    }

    return importer.detectDuplicate(record, context);
  }

  async preparePreview(options: PreviewGenerationOptions): Promise<PreviewComputationResult> {
    const mapper = !options.validator && options.fieldDefinitions && options.fieldMapping
      ? new FieldMapper(options.fieldDefinitions)
      : null;

    const validator = options.validator ?? (mapper
      ? async (record: ParsedRecord) => {
          const { errors } = await mapper.mapRecord(record, options.fieldMapping!);
          return errors;
        }
      : undefined);

    const previewManager = new ImportPreviewManager(options.tenantId);
    const result = await previewManager.generate({
      ...options,
      validator,
    });
    await previewManager.persist(options.importJobId, result);
    return result;
  }
}
