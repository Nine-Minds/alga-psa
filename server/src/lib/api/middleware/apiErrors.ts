/**
 * API error classes, kept free of heavy imports so lightweight modules
 * (e.g. the asset read guard) can throw them. Re-exported by apiMiddleware.
 */

export interface ApiError extends Error {
  statusCode: number;
  code?: string;
  details?: any;
  headers?: Record<string, string>;
}

export class ValidationError extends Error implements ApiError {
  statusCode = 400;
  code = 'VALIDATION_ERROR';
  details: any;

  constructor(message: string, details?: any) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export class UnauthorizedError extends Error implements ApiError {
  statusCode = 401;
  code = 'UNAUTHORIZED';

  constructor(message: string = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error implements ApiError {
  statusCode = 403;
  code = 'FORBIDDEN';

  constructor(message: string = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error implements ApiError {
  statusCode = 404;
  code = 'NOT_FOUND';

  constructor(message: string = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error implements ApiError {
  statusCode = 409;
  code = 'CONFLICT';
  details: any;

  constructor(message: string = 'Resource conflict', details?: any) {
    super(message);
    this.name = 'ConflictError';
    this.details = details;
  }
}

export class BadRequestError extends Error implements ApiError {
  statusCode = 400;
  code = 'BAD_REQUEST';

  constructor(message: string = 'Bad request') {
    super(message);
    this.name = 'BadRequestError';
  }
}

export class UnprocessableEntityError extends Error implements ApiError {
  statusCode = 422;
  code = 'UNPROCESSABLE_ENTITY';
  details: any;

  constructor(message: string = 'Unprocessable entity', details?: any) {
    super(message);
    this.name = 'UnprocessableEntityError';
    this.details = details;
  }
}

export class BadGatewayError extends Error implements ApiError {
  statusCode = 502;
  code = 'BAD_GATEWAY';

  constructor(message: string = 'Bad gateway') {
    super(message);
    this.name = 'BadGatewayError';
  }
}

export class NotImplementedError extends Error implements ApiError {
  statusCode = 501;
  code = 'NOT_IMPLEMENTED';

  constructor(message: string = 'Not implemented') {
    super(message);
    this.name = 'NotImplementedError';
  }
}

export class TooManyRequestsError extends Error implements ApiError {
  statusCode = 429;
  code = 'RATE_LIMITED';
  details: any;
  headers?: Record<string, string>;

  constructor(message: string = 'Too many requests', details?: any) {
    super(message);
    this.name = 'TooManyRequestsError';
    this.details = details;
  }
}
