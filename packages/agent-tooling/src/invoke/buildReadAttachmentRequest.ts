import { READ_ATTACHMENT_ENTITY_TYPES } from '../tools/definitions';
import type { BuiltRequest } from './buildRequest';

/** Raised for bad `read_attachment` arguments; the message is written for the model to act on. */
export class ReadAttachmentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReadAttachmentInputError';
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Map `read_attachment` arguments onto `GET /api/v1/documents/content`. Pure; the caller adds auth and base URL. */
export function buildReadAttachmentRequest(rawArgs: Record<string, unknown> | undefined): BuiltRequest {
  const args = rawArgs ?? {};
  const entityType = args.entity_type;
  if (typeof entityType !== 'string' || !(READ_ATTACHMENT_ENTITY_TYPES as readonly string[]).includes(entityType)) {
    throw new ReadAttachmentInputError(
      `entity_type is required and must be one of: ${READ_ATTACHMENT_ENTITY_TYPES.join(', ')}.`,
    );
  }
  const entityId = nonEmptyString(args.entity_id);
  if (!entityId) {
    throw new ReadAttachmentInputError('entity_id is required (a ticket UUID, or a ticket number such as SR000674).');
  }
  const query: Record<string, string> = { entity_type: entityType, entity_id: entityId };
  const documentId = nonEmptyString(args.document_id);
  if (documentId) query.document_id = documentId;
  const cursor = nonEmptyString(args.cursor);
  if (cursor) query.cursor = cursor;
  return { method: 'GET', path: '/api/v1/documents/content', query, headers: {}, isMutation: false };
}
