import { isEditionGateResponseBody, type EditionGateResponseBody } from './types';

export class EditionGateError extends Error {
  readonly response: EditionGateResponseBody;

  constructor(response: EditionGateResponseBody) {
    super(response.message);
    this.name = 'EditionGateError';
    this.response = response;
  }
}

export function getEditionGateResponse(status: number, body: unknown): EditionGateResponseBody | null {
  return status === 403 && isEditionGateResponseBody(body) ? body : null;
}

export function isEditionGateError(error: unknown): error is EditionGateError {
  return error instanceof EditionGateError;
}
