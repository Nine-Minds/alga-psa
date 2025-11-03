import type { Job } from 'pg-boss';
import { ImportRegistry } from '@/lib/imports/ImportRegistry';
import { ImportManager } from '@/lib/imports/ImportManager';
import { registerDefaultImporters } from '@/lib/imports/registerDefaultImporters';
import { getAssetFieldDefinitions } from '@/lib/imports/assetFieldDefinitions';
import { FieldMapper } from '@/lib/imports/FieldMapper';
import { DuplicateDetector } from '@/lib/imports/DuplicateDetector';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { computeRecordHash } from '@/lib/imports/ExternalEntityMappingRepository';
import { AssetImportJobContext } from '@/lib/imports/importJobContext';
import { createAsset } from 'server/src/lib/actions/asset-actions/assetActions';
import type { CreateAssetRequest } from 'server/src/interfaces/asset.interfaces';
import type { DuplicateDetectionStrategy, FieldMapping, ImportErrorSummary } from '@/types/imports.types';
import { JobService } from 'server/src/services/job.service';
import { JobStatus } from 'server/src/types/job';
import { runWithTenant } from '@/lib/db';
import { ImportJobItemStatus } from '@/types/imports.types';
import { CsvImporter } from '@/lib/imports/CsvImporter';

export interface AssetImportJobData extends Record<string, unknown> {
  tenantId: string;
  userId: string;
  importJobId: string;
  importSourceId?: string;
  jobServiceId: string;
}

interface ErrorAccumulatorEntry {
  field: string;
  sampleMessage: string;
  count: number;
}

const DEFAULT_STRATEGY: DuplicateDetectionStrategy = {
  exactFields: ['serial_number', 'asset_tag', 'mac_address', 'hostname'],
  fuzzyFields: ['name'],
  fuzzyThreshold: 0.82,
  allowMultipleMatches: true
};

const registry = ImportRegistry.getInstance();
registerDefaultImporters(registry);

export async function handleAssetImportJob(job: Job<AssetImportJobData>): Promise<void> {
  const { tenantId, userId, importJobId, jobServiceId } = job.data;
  if (!tenantId) {
    throw new Error('tenantId is required in job payload');
  }
  if (!jobServiceId) {
    throw new Error('jobServiceId is required in job payload');
  }

  const jobService = await JobService.create();
  const importManager = new ImportManager(registry);
  let processedRows = 0;
  let createdRows = 0;
  let duplicateRows = 0;
  let errorRows = 0;

  const updateStatus = async (status: JobStatus, details?: Record<string, unknown>) => {
    await jobService.updateJobStatus(jobServiceId, status, {
      tenantId,
      pgBossJobId: job.id,
      ...details
    });
  };

  await updateStatus(JobStatus.Processing, {
    details: 'Starting asset import job',
    initiatedBy: userId
  });

  try {
    await runWithTenant(tenantId, async () => {
      const jobRecord = await importManager.getImportStatus(tenantId, importJobId);
      if (!jobRecord) {
        throw new Error(`Import job ${importJobId} not found`);
      }

      const context = (jobRecord.context ?? {}) as AssetImportJobContext;
      let fieldMapping = (context.fieldMapping ?? []) as FieldMapping[];
      if ((!fieldMapping || fieldMapping.length === 0) && source.fieldMapping) {
        fieldMapping = Object.entries(source.fieldMapping).map(([sourceField, definition]) => ({
          sourceField,
          targetField: definition.target,
          required: definition.required,
          transformer: definition.transformer
        }));
      }
      const duplicateStrategy =
        (context.duplicateStrategy as DuplicateDetectionStrategy | undefined) ??
        DEFAULT_STRATEGY;

      const source = await importManager.getSourceById(tenantId, jobRecord.import_source_id);
      if (!source) {
        throw new Error('Import source definition missing');
      }

      const importer = registry.get(source.sourceType) ?? new CsvImporter();

      const storageFileId = context.storageFileId;
      if (!storageFileId) {
        throw new Error('Import job is missing storage file reference');
      }

      const { buffer } = await StorageService.downloadFile(storageFileId);
      const parsedRecords = await importer.parse(buffer);
      console.log('[AssetImportJob] Parsed records count:', parsedRecords.length, 'for job', importJobId);

      await importManager.executeImport(tenantId, importJobId);

      const fieldDefinitions = getAssetFieldDefinitions();
      const mapper = new FieldMapper(fieldDefinitions);
      const duplicateDetector = new DuplicateDetector(tenantId, duplicateStrategy);

      const effectiveClientId =
        context.associatedClientId ??
        context.defaultClientId ??
        context.tenantClientId ??
        context.fallbackClientId ??
        null;
      if (!effectiveClientId) {
        throw new Error('Unable to resolve client to attach imported assets to');
      }

      const errorMap = new Map<string, ErrorAccumulatorEntry>();

      for (const record of parsedRecords) {
        processedRows += 1;
        const externalId = record.externalId ?? `row_${record.rowNumber}`;
        const sourceData = record.raw ?? {};

        const mappingResult = await mapper.mapRecord(record, fieldMapping);
        if (mappingResult.errors.length > 0) {
          errorRows += 1;
          mappingResult.errors.forEach((err) => {
            const key = `${err.field ?? '_row'}::${err.message}`;
            const existing = errorMap.get(key);
            if (existing) {
              existing.count += 1;
            } else {
              errorMap.set(key, {
                field: err.field ?? '_row',
                sampleMessage: err.message,
                count: 1
              });
            }
          });

          await importManager.addJobItem(tenantId, importJobId, {
            externalId,
            sourceData,
            status: 'error',
            errorMessage: mappingResult.errors.map((err) => err.message).join('; ')
          });

          await importManager.updateJobStats(tenantId, importJobId, {
            processedRows,
            createdRows,
            duplicateRows,
            errorRows
          });

          continue;
        }

        const duplicate = await duplicateDetector.check(record);
        if (duplicate.isDuplicate) {
          duplicateRows += 1;
          await importManager.addJobItem(tenantId, importJobId, {
            externalId,
            sourceData,
            status: 'duplicate',
            duplicateDetails: duplicate
          });

          await importManager.updateJobStats(tenantId, importJobId, {
            processedRows,
            createdRows,
            duplicateRows,
            errorRows
          });

          continue;
        }

        const mapped = mappingResult.mapped;

        const assetType = String(mapped.asset_type ?? 'unknown').toLowerCase() as CreateAssetRequest['asset_type'];
        const assetName =
          String(mapped.name ?? sourceData['Device Name'] ?? sourceData['Computer Name'] ?? sourceData['Device Hostname'] ?? `Imported Asset ${record.rowNumber}`).trim() || `Imported Asset ${record.rowNumber}`;
        const serialNumber = mapped.serial_number ? String(mapped.serial_number) : undefined;
        const purchaseDate = mapped.purchase_date ? String(mapped.purchase_date) : undefined;
        const warrantyEndDate = mapped.warranty_end_date ? String(mapped.warranty_end_date) : undefined;

        const candidateTags = [
          mapped.asset_tag,
          serialNumber,
          externalId,
          `${importJobId}-${record.rowNumber}`
        ].map((value) => (value ? String(value).trim() : null));

        const assetTag = candidateTags.find((value) => value && value.length > 0) ?? `import-${record.rowNumber}`;

        const assetData: CreateAssetRequest = {
          asset_type: assetType,
          client_id: effectiveClientId,
          asset_tag: assetTag,
          name: assetName,
          status: 'active',
          serial_number: serialNumber,
          purchase_date: purchaseDate,
          warranty_end_date: warrantyEndDate
        };

        try {
          const asset = await createAsset(assetData);
          createdRows += 1;

          const sourceHash = computeRecordHash(sourceData);

          await importManager.saveExternalMapping(tenantId, {
            assetId: asset.asset_id,
            importJobId,
            importSourceId: jobRecord.import_source_id,
            externalId,
            sourceHash,
            metadata: {
              rowNumber: record.rowNumber,
              storageFileId,
              uploadedBy: context.uploadedById
            }
          });

          await importManager.addJobItem(tenantId, importJobId, {
            externalId,
            assetId: asset.asset_id,
            sourceData,
            status: 'created',
            mappedData: { assetId: asset.asset_id, assetTag }
          });
        } catch (err) {
          errorRows += 1;
          const message = err instanceof Error ? err.message : 'Failed to create asset';
          console.error('[AssetImportJob] Failed to create asset for job', importJobId, 'row', externalId, message, err);
          const key = `_asset::${message}`;
          const existing = errorMap.get(key);
          if (existing) {
            existing.count += 1;
          } else {
            errorMap.set(key, {
              field: '_asset',
              sampleMessage: message,
              count: 1
            });
          }

          await importManager.addJobItem(tenantId, importJobId, {
            externalId,
            sourceData,
            status: 'error',
            errorMessage: message
          });
        }

        await importManager.updateJobStats(tenantId, importJobId, {
          processedRows,
          createdRows,
          duplicateRows,
          errorRows
        });

        if (processedRows % 10 === 0 || processedRows === parsedRecords.length) {
          await updateStatus(JobStatus.Processing, {
            stepResult: {
              step: 'asset_import',
              status: 'running',
              processedRows,
              totalRows: parsedRecords.length
            }
          });
        }
      }

      const errorSummary: ImportErrorSummary | null = errorRows
        ? {
            totalErrors: Array.from(errorMap.values()).reduce((sum, entry) => sum + entry.count, 0),
            rowsWithErrors: errorRows,
            topErrors: Array.from(errorMap.values())
              .sort((a, b) => b.count - a.count)
              .slice(0, 10)
              .map((entry) => ({
                field: entry.field,
                count: entry.count,
                sampleMessage: entry.sampleMessage
              }))
          }
        : null;

      await importManager.updateJobStats(tenantId, importJobId, {
        processedRows,
        createdRows,
        duplicateRows,
        errorRows,
        status: 'completed',
        completedAt: new Date().toISOString(),
        errorSummary
      });
    });

    await updateStatus(JobStatus.Completed, {
      details: 'Asset import completed successfully',
      initiatedBy: userId
    });
  } catch (error) {
    try {
      await runWithTenant(tenantId, async () => {
        await importManager.updateJobStats(tenantId, importJobId, {
          status: 'failed',
          processedRows,
          createdRows,
          duplicateRows,
          errorRows,
          completedAt: new Date().toISOString()
        });
      });
    } catch (updateError) {
      console.error('[AssetImportJob] Failed to update job stats after failure', updateError);
    }
    await updateStatus(JobStatus.Failed, {
      error,
      details: 'Asset import failed',
      initiatedBy: userId
    });
    throw error;
  }
}
