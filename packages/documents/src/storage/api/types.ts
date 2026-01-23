type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface StorageKey {
  tenantId: string;
  namespace: string;
  key: string;
}

export interface StorageRecord extends StorageKey {
  revision: number;
  value: JsonValue;
  metadata: Record<string, JsonValue>;
  ttlExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoragePutRequest {
  namespace: string;
  key: string;
  value: JsonValue;
  metadata?: Record<string, JsonValue>;
  ttlSeconds?: number;
  ifRevision?: number;
  schemaVersion?: number;
}

export interface StorageBulkPutRequest {
  namespace: string;
  items: Array<{
    key: string;
    value: JsonValue;
    metadata?: Record<string, JsonValue>;
    ttlSeconds?: number;
    ifRevision?: number;
    schemaVersion?: number;
  }>;
}

export interface StorageDeleteRequest {
  namespace: string;
  key: string;
  ifRevision?: number;
}

export interface StorageGetRequest {
  namespace: string;
  key: string;
  ifRevision?: number;
}

export interface StoragePutResponse {
  namespace: string;
  key: string;
  revision: number;
  ttlExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StorageBulkPutResponseItem {
  key: string;
  revision: number;
  ttlExpiresAt: Date | null;
}

export interface StorageBulkPutResponse {
  namespace: string;
  items: StorageBulkPutResponseItem[];
}

export interface StorageGetResponse {
  namespace: string;
  key: string;
  revision: number;
  value: JsonValue;
  metadata: Record<string, JsonValue>;
  ttlExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StorageListRequest {
  namespace: string;
  limit?: number;
  cursor?: string | null;
  keyPrefix?: string;
  includeValues?: boolean;
  includeMetadata?: boolean;
}

export interface StorageListItem extends StorageKey {
  revision: number;
  value?: JsonValue;
  metadata?: Record<string, JsonValue>;
  ttlExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StorageListResponse {
  items: StorageListItem[];
  nextCursor: string | null;
}

export interface StorageQuota {
  maxNamespaces: number;
  maxKeysPerNamespace: number;
  maxValueBytes: number;
  maxMetadataBytes: number;
  maxBulkPayloadBytes: number;
  maxBulkItems: number;
  totalBytes: number;
}

export interface StorageUsage {
  tenantId: string;
  bytesUsed: number;
  keysCount: number;
  namespacesCount: number;
  updatedAt: Date;
}

export interface SchemaRegistration {
  tenantId: string;
  namespace: string;
  schemaVersion: number;
  schemaDocument: JsonValue;
  status: 'active' | 'deprecated' | 'draft';
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}
