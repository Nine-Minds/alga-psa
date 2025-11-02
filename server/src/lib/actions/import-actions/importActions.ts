'use server';

import { createTenantKnex } from '@/lib/db';
import { ImportManager } from '@/lib/imports/ImportManager';
import { ImportRegistry } from '@/lib/imports/ImportRegistry';
import { CsvImporter } from '@/lib/imports/CsvImporter';
import { NableExportImporter } from '@/lib/imports/NableExportImporter';
import { ConnectWiseRmmExportImporter } from '@/lib/imports/ConnectWiseRmmExportImporter';
import { DattoRmmExportImporter } from '@/lib/imports/DattoRmmExportImporter';
import { getAssetFieldDefinitions } from '@/lib/imports/assetFieldDefinitions';
import { DuplicateDetector } from '@/lib/imports/DuplicateDetector';
import { Buffer } from 'node:buffer';
import type {
  FieldMapping,
  FieldMappingTemplate,
  ImportFilters,
  PreviewComputationResult,
  PreviewGenerationOptions,
  DuplicateDetectionStrategy
} from '@/types/imports.types';
import { getCurrentUser } from '../user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';

const importRegistry = ImportRegistry.getInstance();
importRegistry.registerMany([
  new CsvImporter(),
  new NableExportImporter(),
  new ConnectWiseRmmExportImporter(),
  new DattoRmmExportImporter()
]);

const importManager = new ImportManager(importRegistry);

async function requirePermission(action: 'read' | 'manage'): Promise<{ tenant: string; userId: string }> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const allowed = await hasPermission(currentUser, 'import_export', action);
  if (!allowed) {
    throw new Error('Permission denied for import/export settings');
  }

  const { tenant } = await createTenantKnex();
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

  const source = await importManager.getSourceById(tenant, importSourceId);
  if (!source) {
    throw new Error('Import source not found');
  }

  const importer = importRegistry.get(source.sourceType) ?? new CsvImporter();
  importRegistry.register(importer);

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

  const job = await importManager.initiateImport(tenant, source.id, {
    createdBy: userId,
    file: {
      fileName: file.name,
      originalName: file.name,
      size: file.size,
      mimeType: file.type,
    },
    totalRows: parsedRecords.length,
  });

  const defaultStrategy = importer.getDuplicateDetectionStrategy();
  const metadataStrategy = source.metadata?.duplicateDetectionStrategy as
    | DuplicateDetectionStrategy
    | undefined;
  const duplicateStrategy: DuplicateDetectionStrategy = defaultStrategy ?? metadataStrategy ?? {
    exactFields: ['serial_number', 'asset_tag', 'mac_address', 'hostname'],
    fuzzyFields: ['name'],
    fuzzyThreshold: 0.82
  };

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
