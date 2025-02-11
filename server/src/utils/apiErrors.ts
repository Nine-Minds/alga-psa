export const ErrorCodes = {
  // Authentication Errors (AUTH)
  AUTH001: 'Invalid API key',
  AUTH002: 'Expired API key',
  AUTH003: 'Insufficient permissions',
  AUTH004: 'Missing API key',

  // Request Errors (REQ)
  REQ001: 'Invalid request parameters',
  REQ002: 'Missing required parameters',
  REQ003: 'Invalid request format',
  REQ004: 'Unsupported HTTP method',

  // Resource Errors (RES)
  RES001: 'Resource not found',
  RES002: 'Resource already exists',
  RES003: 'Resource is locked',
  RES004: 'Resource is inactive',

  // Rate Limiting (RATE)
  RATE001: 'Rate limit exceeded',
  RATE002: 'Too many requests',

  // Server Errors (SRV)
  SRV001: 'Internal server error',
  SRV002: 'Service unavailable',
  SRV003: 'Database error',
  SRV004: 'External service error',

  // Tenant Errors (TNT)
  TNT001: 'Invalid tenant',
  TNT002: 'Tenant not found',
  TNT003: 'Tenant is inactive',
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

interface ApiErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function formatApiError(
  code: ErrorCode,
  details?: Record<string, unknown>
): ApiErrorResponse {
  return {
    error: {
      code,
      message: ErrorCodes[code],
      ...(details && { details }),
    },
  };
}

export function getStatusCodeForError(code: ErrorCode): number {
  if (code.startsWith('AUTH')) return 401;
  if (code.startsWith('REQ')) return 400;
  if (code.startsWith('RES')) return 404;
  if (code.startsWith('RATE')) return 429;
  if (code.startsWith('TNT')) return 403;
  return 500; // Default to internal server error for SRV and unknown codes
}
