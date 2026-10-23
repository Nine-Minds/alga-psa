export type ServiceRequestDefinitionErrorCode =
  | 'TEMPLATE_UNAVAILABLE'
  | 'SOURCE_DEFINITION_NOT_FOUND'
  | 'DEFINITION_NOT_FOUND';

export class ServiceRequestDefinitionBusinessError extends Error {
  constructor(
    public readonly code: ServiceRequestDefinitionErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ServiceRequestDefinitionBusinessError';
  }
}
