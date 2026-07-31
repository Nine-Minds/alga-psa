import type { ErrorRequestHandler } from 'express';

import { AuthenticationError, AuthenticationServiceError } from '../auth/types.js';
import { HttpError } from './errors.js';
import { InputValidationError } from './input.js';

interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

function jsonBodyError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'entity.parse.failed'
  );
}

export const gatewayErrorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  let status = 500;
  let code = 'internal_error';
  let message = 'The AI gateway could not complete the request.';

  if (error instanceof HttpError) {
    status = error.status;
    code = error.code;
    message = error.message;
  } else if (error instanceof AuthenticationError) {
    status = 401;
    code = 'unauthorized';
    message = error.message;
  } else if (error instanceof AuthenticationServiceError) {
    status = 503;
    code = 'authentication_unavailable';
    message = 'Appliance authentication is temporarily unavailable.';
  } else if (error instanceof InputValidationError || jsonBodyError(error)) {
    status = 400;
    code = 'invalid_request';
    message = error instanceof InputValidationError ? error.message : 'Request body is invalid JSON.';
  } else {
    console.error('Unhandled AI gateway request error', error);
  }

  const body: ErrorResponse = { error: { code, message } };
  response.status(status).json(body);
};
