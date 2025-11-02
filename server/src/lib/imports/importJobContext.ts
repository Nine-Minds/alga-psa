import type { FieldMapping, DuplicateDetectionStrategy } from '@/types/imports.types';

export interface AssetImportJobContext {
  storageFileId: string;
  storageFileName: string;
  storageFileSize: number;
  storageMimeType: string;
  fieldMapping: FieldMapping[];
  duplicateStrategy: DuplicateDetectionStrategy;
  defaultClientId: string | null;
  tenantClientId: string | null;
  uploadedById: string;
}
