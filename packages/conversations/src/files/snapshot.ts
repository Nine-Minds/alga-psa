import { createHash } from 'node:crypto';
import {
  CONVERSATION_FILE_MAX_BYTES, CONVERSATION_FILE_MIME_MAX_LENGTH, CONVERSATION_FILE_NAME_MAX_LENGTH,
} from '../limits';
import { ConversationFileError } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isConversationFileUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
export const sha256Hex = (content: Uint8Array | string): string => createHash('sha256').update(content).digest('hex');

export interface ConversationFileSnapshot { fileName: string; mimeType: string; content: Buffer; size: number; contentHash: string }

/** Validates name, mime type and size, then fixes the bytes and their sha256. Boundary: exactly
 * CONVERSATION_FILE_MAX_BYTES passes. */
export function snapshotConversationFile(input: { fileName: unknown; mimeType: unknown; content: unknown }): ConversationFileSnapshot {
  const { fileName, mimeType, content } = input ?? ({} as typeof input);
  if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > CONVERSATION_FILE_NAME_MAX_LENGTH || /[\\/\u0000-\u001f\u007f]/.test(fileName)
    || typeof mimeType !== 'string' || mimeType.length > CONVERSATION_FILE_MIME_MAX_LENGTH || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mimeType)
    || !(content instanceof Uint8Array) || content.length > CONVERSATION_FILE_MAX_BYTES) throw new ConversationFileError('INVALID_FILE');
  const bytes = Buffer.from(content);
  return { fileName, mimeType: mimeType.toLowerCase(), content: bytes, size: bytes.length, contentHash: sha256Hex(bytes) };
}

/** Throws FILE_CONTENT_MISMATCH unless the bytes are exactly the recorded size and hash. */
export function assertConversationFileBytes(content: Uint8Array, expected: { size: number; contentHash: string }): void {
  if (content.length !== expected.size || sha256Hex(content) !== expected.contentHash) throw new ConversationFileError('FILE_CONTENT_MISMATCH');
}
