'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { ImportManager } from '@/lib/imports/ImportManager';
import { ImportRegistry } from '@/lib/imports/ImportRegistry';
import { CsvImporter } from '@/lib/imports/CsvImporter';
import { getAssetFieldDefinitions } from '@/lib/imports/assetFieldDefinitions';
import type {
  FieldMapping,
  FieldMappingTemplate,
  ImportFilters,
  PreviewComputationResult,
  PreviewGenerationOptions,
  ParsedRecord
} from '@/types/imports.types';
import { getCurrentUser } from '../user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';

const importRegistry = ImportRegistry.getInstance();
importRegistry.register(new CsvImporter());

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

  const importSourceId = formData.get('importSourceId') as string;
  const fieldMapping = JSON.parse(String(formData.get('fieldMapping') ?? '[]')) as FieldMapping[];
  const file = formData.get('file') as File;

  if (!importSourceId) {
    throw new Error('Missing importSourceId');
  }

  if (!file) {
    throw new Error('No file provided');
  }

  const source = await importManager.getSourceById(tenant, importSourceId);
  if (!source) {
    throw new Error('Import source not found');
  }

  const importer = importRegistry.get(source.sourceType) ?? new CsvImporter();
  importRegistry.register(importer);

  const buffer = Buffer.from(await file.arrayBuffer());

  const parsedRecords = await importer.parse(buffer);

  fieldMapping.forEach((mapping) => {
    if (!mapping.sourceField || !mapping.targetField) {
      throw new Error('Invalid field mapping entry. Each mapping requires sourceField and targetField.');
    }
  });

  if (!fieldMapping.length) {
    throw new Error('Field mapping is required to prepare a preview');
  }

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

  const options: PreviewGenerationOptions = {
    tenantId: tenant,
    importJobId: job.import_job_id,
    records: parsedRecords as ParsedRecord[],
    fieldDefinitions: getAssetFieldDefinitions(),
    fieldMapping,
  };

  const result = await importManager.preparePreview(options);

  const persistTemplate = String(formData.get('persistTemplate') ?? 'false') === 'true';
  if (persistTemplate) {
    const template: FieldMappingTemplate = fieldMapping.reduce((acc, mapping) => {
      acc[mapping.sourceField] = {
        target: mapping.targetField,
        required: mapping.required,
        transformer: mapping.transformer,
      };
      return acc;
    }, {} as FieldMappingTemplate);

    await importManager.saveFieldMappingTemplate(tenant, importSourceId, template);
  }

  return {
    ...result,
    importJobId: job.import_job_id,
  };
}
