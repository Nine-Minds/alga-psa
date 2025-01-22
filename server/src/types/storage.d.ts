// Base interface for all provider configs
interface BaseProviderConfig {
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
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    endpoint?: string;
}

type StorageProviderConfig = LocalProviderConfig | S3ProviderConfig;

interface StorageConfig {
    defaultProvider: string;
    providers: Record<string, StorageProviderConfig>;
}

export interface StorageProvider {
    tenant: string;
    provider_type: 'local' | 's3' | 'azure' | 'gcs' | 'sftp';
    config: {
        s3?: {
            region: string;
            bucket: string;
            access_key: string;
            secret_key: string;
        };
        azure?: {
            container: string;
            account: string;
            key: string;
        };
        gcs?: {
            project_id: string;
            bucket: string;
            credentials: string;
        };
        sftp?: {
            host: string;
            port: number;
            username: string;
            private_key: string;
            base_path: string;
        };
        local?: {
            base_path: string;
        };
    };
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

export interface FileUploadRequest {
    file: File;
    entity_type?: string;
    entity_id?: string;
}

export interface FileDownloadRequest {
    file_id: string;
}
export interface FileDeleteRequest {
    file_id: string;
}

export class StorageService {
  createWriteStream(filename: string): Writable;
  finalizeWriteStream(stream: Writable, metadata: FileMetadata): Promise<FileStore>;
  getFileStream(path: string): Promise<Readable>;
  storeFile(tenantId: string, stream: Readable, options: FileMetadata): Promise<FileStore>;
  createTempFile(tenantId: string, extension: string): Promise<{ file_id: string }>;
}

