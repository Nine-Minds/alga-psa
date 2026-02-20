// Base interface for all provider configs
export interface BaseProviderConfig {
  type: string;
  maxFileSize: number;
  allowedMimeTypes: string[];
  retentionDays: number;
}

export interface LocalProviderConfig extends BaseProviderConfig {
  type: 'local';
  basePath: string;
}

export interface S3ProviderConfig extends BaseProviderConfig {
  type: 's3';
  region?: string;
  bucket?: string;
  accessKey?: string;
  secretKey?: string;
  endpoint?: string;
}

export type StorageProviderConfig = LocalProviderConfig | S3ProviderConfig;

export interface StorageConfig {
  defaultProvider: string;
  providers: Record<string, StorageProviderConfig>;
}

export interface StorageCapabilities {
  supportsBuckets: boolean;
  supportsStreaming: boolean;
  supportsMetadata: boolean;
  supportsTags: boolean;
  supportsVersioning: boolean;
  maxFileSize?: number;
  allowedMimeTypes?: string[];
}

export interface FileStore {
  tenant: string;
  file_id: string;
  fileId: string;
  file_name: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  storage_path: string;
  uploaded_by_id: string;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  deleted_at?: string;
  deleted_by_id?: string;
  metadata?: Record<string, any>;
}

export interface DocumentSystemEntry {
  file_id: string;
  category: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

