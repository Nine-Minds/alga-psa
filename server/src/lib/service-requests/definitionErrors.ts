export type ServiceRequestDefinitionErrorCode =
  | 'TEMPLATE_UNAVAILABLE'
  | 'SOURCE_DEFINITION_NOT_FOUND'
  | 'DEFINITION_NOT_FOUND'
  | 'STORE_ONLY_AUTHORING_DISABLED';

export class ServiceRequestDefinitionBusinessError extends Error {
  constructor(
    public readonly code: ServiceRequestDefinitionErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ServiceRequestDefinitionBusinessError';
  }
}
