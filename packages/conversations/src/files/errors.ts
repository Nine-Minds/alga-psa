export const CONVERSATION_FILE_ERROR_CODES = [
  'INVALID_FILE', 'FILE_OPERATION_CONFLICT', 'FILE_CONTENT_MISMATCH', 'FILE_NOT_FOUND', 'FILE_LIMIT_EXCEEDED',
] as const;
export type ConversationFileErrorCode = (typeof CONVERSATION_FILE_ERROR_CODES)[number];

const MESSAGES: Record<ConversationFileErrorCode, string> = {
  INVALID_FILE: 'The file is not valid.',
  FILE_OPERATION_CONFLICT: 'This operation was already used for a different request.',
  FILE_CONTENT_MISMATCH: 'The stored file does not match its recorded content.',
  FILE_NOT_FOUND: 'The file was not found.',
  FILE_LIMIT_EXCEEDED: 'Too many files for one publication.',
};

/** Messages are fixed: they never echo tenant, owner or storage details. */
export class ConversationFileError extends Error {
  constructor(public readonly code: ConversationFileErrorCode) {
    super(MESSAGES[code]);
    this.name = 'ConversationFileError';
  }
}
export const isConversationFileError = (error: unknown): error is ConversationFileError => error instanceof ConversationFileError;
