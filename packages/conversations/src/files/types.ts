import type { Knex } from 'knex';

export interface ConversationFileActor { tenant: string; userId: string }
/** The record a file belongs to. The engine never interprets `ownerType`. */
export interface ConversationFileOwner { ownerType: string; ownerId: string; conversationId?: string | null }

export interface ConversationFileStorage {
  upload(path: string, content: Uint8Array, mimeType: string): Promise<void>;
  download(path: string): Promise<Uint8Array>;
  delete(path: string): Promise<void>;
}

export type ConversationFileStatus = 'pending' | 'ready';
export interface ConversationFileRow {
  tenant: string; file_id: string; owner_type: string; owner_id: string; conversation_id: string | null;
  actor_user_id: string; file_name: string; mime_type: string; file_size: number | string;
  content_hash: string; request_hash: string; storage_path: string; status: ConversationFileStatus;
  publication_operation_id: string | null; source_file_id: string | null;
  discarded_at: Date | null; purged_at: Date | null; cleanup_attempts: number;
}

export interface ConversationFileSummary {
  fileId: string; fileName: string; mimeType: string; size: number; contentHash: string;
}

export interface PublicationManifestEntry {
  fileId: string; sourceFileId: string; fileName: string; contentHash: string; size: number;
}
export type ConversationFilePublicationStatus = 'prepared' | 'published' | 'abandoned';
export interface ConversationFilePublicationReceipt {
  operationId: string; ownerType: string; ownerId: string; conversationId: string | null;
  status: ConversationFilePublicationStatus; requestHash: string; manifest: PublicationManifestEntry[];
  preparedAt: string; publishedAt: string | null; abandonedAt: string | null;
}

export type ConversationFileTrx = Knex.Transaction;
