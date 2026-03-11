export interface TeamsActionErrorDetails {
  path?: Array<string | number>;
  message?: string;
}

export class ValidationError extends Error {
  statusCode = 400;
  code = 'VALIDATION_ERROR';
  details: TeamsActionErrorDetails[];

  constructor(message: string, details: TeamsActionErrorDetails[] = []) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export class ForbiddenError extends Error {
  statusCode = 403;
  code = 'FORBIDDEN';

  constructor(message: string = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  statusCode = 404;
  code = 'NOT_FOUND';

  constructor(message: string = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}
