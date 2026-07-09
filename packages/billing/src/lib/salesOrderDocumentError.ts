export type SalesOrderDocumentErrorCode = 'permission_denied' | 'not_found' | 'generation_failed';

export class SalesOrderDocumentError extends Error {
  constructor(
    message: string,
    public readonly code: SalesOrderDocumentErrorCode,
  ) {
    super(message);
    this.name = 'SalesOrderDocumentError';
  }
}
