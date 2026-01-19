'use server';

import { Buffer } from 'node:buffer';
import { createTenantKnex } from '@/lib/db';
import { ImportManager } from '@/lib/imports/ImportManager';
import { ImportRegistry } from '@/lib/imports/ImportRegistry';
import { CsvImporter } from '@/lib/imports/CsvImporter';
import { getAssetFieldDefinitions } from '@/lib/imports/assetFieldDefinitions';
import { DuplicateDetector } from '@/lib/imports/DuplicateDetector';
import { registerDefaultImporters } from '@/lib/imports/registerDefaultImporters';
import { StorageService } from '@alga-psa/documents/storage/StorageService';
import { AssetImportJobContext } from '@/lib/imports/importJobContext';
import { JobService } from '@alga-psa/jobs';
import { addDocument, associateDocumentWithClient, deleteDocument } from '@alga-psa/documents/actions/documentActions';
import type {
  FieldMapping,
  FieldMappingTemplate,
  ImportFilters,
  PreviewComputationResult,
  PreviewGenerationOptions,
  DuplicateDetectionStrategy
} from '@/types/imports.types';
import { getCurrentUser } from '@alga-psa/users/actions';
import { hasPermission } from '@alga-psa/auth';

const MAX_IMPORT_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
const SUPPORTED_IMPORT_EXTENSIONS = ['.csv', '.xlsx'];
const SUPPORTED_IMPORT_MIME_TYPES = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

const importRegistry = ImportRegistry.getInstance();
registerDefaultImporters(importRegistry);

const importManager = new ImportManager(importRegistry);

async function requirePermission(action: 'read' | 'manage'): Promise<{ tenant: string; userId: string }> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const allowed =
    (await hasPermission(currentUser, 'import_export', action)) ||
    (await hasPermission(
      currentUser,
      'account_management',
      action === 'read' ? 'read' : 'update'
    ));
  if (!allowed) {
    throw new Error('Permission denied for import/export settings');
  }

  const tenant = currentUser.tenant;
  if (!tenant) {
    throw new Error('No tenant found');
  }

  return { tenant, userId: currentUser.user_id };
}

export async function getImportSources(includeInactive = false) {
  const { tenant } = await requirePermission('read');
  const sources = await importManager.getAvailableSources(tenant, includeInactive);
  return sources.map((source) => source.toRecord());
}

export async function getImportFieldDefinitions() {
  await requirePermission('read');
  return getAssetFieldDefinitions();
}

export async function getImportFieldMapping(importSourceId: string): Promise<FieldMappingTemplate | null> {
  const { tenant } = await requirePermission('read');
  return importManager.getFieldMappingTemplate(tenant, importSourceId);
}

export async function saveImportFieldMapping(
  importSourceId: string,
  template: FieldMappingTemplate
): Promise<FieldMappingTemplate | null> {
  const { tenant } = await requirePermission('manage');
  return importManager.saveFieldMappingTemplate(tenant, importSourceId, template);
}

export async function listImportJobs(filters: ImportFilters = {}) {
  const { tenant } = await requirePermission('read');
  return importManager.getImportHistory(tenant, filters);
}

export async function getImportJobDetails(importJobId: string) {
  const { tenant } = await requirePermission('read');

  if (typeof importJobId !== 'string' || importJobId.trim().length === 0) {
    throw new Error('importJobId is required');
  }

  const details = await importManager.getImportDetails(tenant, importJobId);
  if (!details) {
    throw new Error('Import job not found');
  }

  return details;
}

export async function createImportPreview(formData: FormData): Promise<PreviewComputationResult & {
  importJobId: string;
}> {
  const { tenant, userId } = await requirePermission('manage');

  const importSourceId = formData.get('importSourceId');
  const mappingRaw = formData.get('fieldMapping');
  const fileEntry = formData.get('file');
  const persistTemplateEntry = formData.get('persistTemplate');

  if (typeof importSourceId !== 'string' || importSourceId.trim().length === 0) {
    throw new Error('Missing importSourceId');
  }

  const fieldMapping = JSON.parse(
    typeof mappingRaw === 'string' && mappingRaw.trim().length > 0 ? mappingRaw : '[]'
  ) as FieldMapping[];

  if (!(fileEntry instanceof File)) {
    throw new Error('No file provided');
  }

  const file = fileEntry;
  const shouldPersistTemplate =
    typeof persistTemplateEntry === 'string' ? persistTemplateEntry === 'true' : false;
  const defaultClientParam = formData.get('defaultClientId');
  const requestedDefaultClientId =
    typeof defaultClientParam === 'string' && defaultClientParam.trim().length > 0
      ? defaultClientParam.trim()
      : null;

  if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
    throw new Error('Import files must be 100 MB or smaller.');
  }

  const normalizedName = file.name?.toLowerCase() ?? '';
  const extension = normalizedName.includes('.') ? normalizedName.slice(normalizedName.lastIndexOf('.')) : '';
  if (!SUPPORTED_IMPORT_EXTENSIONS.includes(extension)) {
    throw new Error('Unsupported file format. Upload a CSV or XLSX file.');
  }

  if (file.type && file.type.length > 0 && !SUPPORTED_IMPORT_MIME_TYPES.has(file.type)) {
    throw new Error(`Unsupported MIME type "${file.type}". Upload a CSV or XLSX file.`);
  }

  let tenantClientId: string | null = null;
  let fallbackClientId: string | null = null;
  try {
    const { knex } = await createTenantKnex(tenant);
    const tenantClient = await knex('tenant_companies')
      .select('client_id')
      .where({ tenant, is_default: true })
      .first();
    tenantClientId = tenantClient?.client_id ?? null;

    if (!tenantClientId) {
      const fallbackClient = await knex('clients')
        .select('client_id')
        .where({ tenant, is_inactive: false })
        .orderBy('created_at', 'asc')
        .first();
      fallbackClientId = fallbackClient?.client_id ?? null;
    }
  } catch (error) {
    console.warn('[ImportActions] Failed to resolve default tenant client', error);
  }
  const associatedClientId = requestedDefaultClientId ?? tenantClientId ?? fallbackClientId ?? null;

  const source = await importManager.getSourceById(tenant, importSourceId);
  if (!source) {
    throw new Error('Import source not found');
  }

  const importer = importRegistry.get(source.sourceType) ?? new CsvImporter();
  registerDefaultImporters(importRegistry);

  await StorageService.validateFileUpload(
    tenant,
    file.type && file.type.length > 0 ? file.type : 'application/octet-stream',
    file.size
  );

  const buffer = Buffer.from(await file.arrayBuffer());

  fieldMapping.forEach((mapping) => {
    if (!mapping.sourceField || !mapping.targetField) {
      throw new Error('Invalid field mapping entry. Each mapping requires sourceField and targetField.');
    }
  });

  if (!fieldMapping.length) {
    throw new Error('Field mapping is required to prepare a preview');
  }

  const parsedRecords = await importer.parse(buffer);

  const defaultStrategy = importer.getDuplicateDetectionStrategy();
  const metadataStrategy = source.metadata?.duplicateDetectionStrategy as
    | DuplicateDetectionStrategy
    | undefined;
  const duplicateStrategy: DuplicateDetectionStrategy = defaultStrategy ?? metadataStrategy ?? {
    exactFields: ['serial_number', 'asset_tag', 'mac_address', 'hostname'],
    fuzzyFields: ['name'],
    fuzzyThreshold: 0.82
  };

  const fileRecord = await StorageService.uploadFile(tenant, buffer, file.name, {
    mime_type: file.type,
    uploaded_by_id: userId,
    metadata: {
      context: 'asset_import',
      import_source_id: source.id
    }
  });

  let documentId: string | null = null;
  let documentAssociationId: string | null = null;

  try {
    const documentResult = await addDocument({
      tenant,
      document_name: file.name,
      type_id: null,
      user_id: userId,
      order_number: 0,
      created_by: userId,
      file_id: fileRecord.file_id,
      storage_path: fileRecord.storage_path,
      mime_type: fileRecord.mime_type,
      file_size: fileRecord.file_size ?? file.size
    });

    documentId = documentResult._id;

    if (associatedClientId) {
      const association = await associateDocumentWithClient({
        document_id: documentResult._id,
        entity_id: associatedClientId,
        entity_type: 'client',
        tenant
      });
      documentAssociationId = association.association_id;
    }
  } catch (error) {
    console.error('[ImportActions] Failed to persist import document', error);
    let documentRemoved = false;
    if (documentId) {
      try {
        await deleteDocument(documentId, userId);
        documentRemoved = true;
      } catch (docCleanupError) {
        console.warn('[ImportActions] Failed to cleanup document after error', docCleanupError);
      }
    }
    if (!documentRemoved) {
      try {
        await StorageService.deleteFile(fileRecord.file_id, userId);
      } catch (cleanupError) {
        console.warn('[ImportActions] Failed to cleanup uploaded file after document error', cleanupError);
      }
    }
    throw error instanceof Error ? error : new Error('Failed to persist import document');
  }

  const jobContext: AssetImportJobContext = {
    storageFileId: fileRecord.file_id,
    storageFileName: fileRecord.original_name ?? file.name,
    storageFileSize: fileRecord.file_size ?? file.size,
    storageMimeType: fileRecord.mime_type ?? file.type,
    fieldMapping,
    duplicateStrategy,
    defaultClientId: associatedClientId,
    tenantClientId,
    fallbackClientId,
    uploadedById: userId,
    documentId,
    documentAssociationId,
    associatedClientId
  };

  const job = await importManager.initiateImport(tenant, source.id, {
    createdBy: userId,
    fileId: fileRecord.file_id,
    documentId,
    documentAssociationId,
    file: {
      fileName: file.name,
      originalName: file.name,
      size: file.size,
      mimeType: file.type,
    },
    totalRows: parsedRecords.length,
    context: jobContext as unknown as Record<string, unknown>
  });

  try {
    await StorageService.createDocumentSystemEntry({
      fileId: fileRecord.file_id,
      category: 'asset-import-source',
      metadata: {
        import_job_id: job.import_job_id,
        import_source_id: source.id,
        original_name: fileRecord.original_name ?? file.name,
        document_id: documentId,
        document_association_id: documentAssociationId,
        associated_client_id: associatedClientId,
        fallback_client_id: jobContext.fallbackClientId
      }
    });
  } catch (error) {
    console.warn('[ImportActions] Failed to create document entry for import source', error);
  }

  const duplicateDetector = new DuplicateDetector(tenant, duplicateStrategy);

  const options: PreviewGenerationOptions = {
    tenantId: tenant,
    importJobId: job.import_job_id,
    records: parsedRecords,
    fieldDefinitions: getAssetFieldDefinitions(),
    fieldMapping,
    duplicateDetector,
  };

  const result = await importManager.preparePreview(options);

  if (shouldPersistTemplate) {
    const template = fieldMapping.reduce<FieldMappingTemplate>((acc, mapping) => {
      acc[mapping.sourceField] = {
        target: mapping.targetField,
        required: mapping.required,
        transformer: mapping.transformer,
      };
      return acc;
    }, {});

    await importManager.saveFieldMappingTemplate(tenant, importSourceId, template);
  }

  return {
    ...result,
    importJobId: job.import_job_id,
  };
}

export async function approveImport(importJobId: string) {
  const { tenant, userId } = await requirePermission('manage');

  if (typeof importJobId !== 'string' || importJobId.trim().length === 0) {
    throw new Error('importJobId is required');
  }

  const job = await importManager.getImportStatus(tenant, importJobId);
  if (!job) {
    throw new Error('Import job not found');
  }

  if (job.status !== 'preview' && job.status !== 'failed') {
    throw new Error('Import job is not ready for approval');
  }

  if (job.job_id) {
    throw new Error('Import job is already queued for processing');
  }

  const jobService = await JobService.create();

  try {
    const { jobRecord, scheduledJobId } = await jobService.createAndScheduleJob(
      'asset_import',
      {
        tenantId: tenant,
        metadata: {
          user_id: userId,
          importJobId
        },
        importJobId,
        importSourceId: job.import_source_id,
        userId
      }
    );

    if (!jobRecord.id) {
      throw new Error('Failed to create job record');
    }

    await importManager.attachBackgroundJob(tenant, importJobId, jobRecord.id, 'validating');

    return {
      jobId: jobRecord.id,
      scheduledJobId,
      status: 'validating' as const
    };
  } catch (error) {
    console.error('[ImportActions] Failed to queue asset import job', error);
    await importManager.updateJobStats(tenant, importJobId, { status: 'failed' });
    throw error instanceof Error ? error : new Error('Failed to queue asset import job');
  }
}
