import { NextResponse } from 'next/server';
import { AuthenticationError } from '@alga-psa/auth';

type TemplateRouteError = {
  status: number;
  message: string;
};

/**
 * A caller without a resolvable identity (no session and no usable API key) is a
 * 401, never a 500: `withAuth` throws AuthenticationError and
 * `authenticateApiKeyRequest` throws UnauthorizedError (statusCode 401).
 */
function unauthenticatedStatus(error: unknown): number | undefined {
  if (error instanceof AuthenticationError) {
    return 401;
  }
  const candidate = error as { name?: string; statusCode?: unknown };
  if (candidate?.name === 'AuthenticationError' || candidate?.name === 'UnauthorizedError') {
    return typeof candidate.statusCode === 'number' ? candidate.statusCode : 401;
  }
  return undefined;
}

export function isTemplateActionError(value: unknown): value is { actionError: string } | { permissionError: string } {
  const candidate = value as Record<string, unknown>;
  return (
    typeof value === 'object' &&
    value !== null &&
    (
      typeof candidate.actionError === 'string' ||
      typeof candidate.permissionError === 'string'
    )
  );
}

function templateRouteErrorFrom(error: unknown, fallbackMessage: string): TemplateRouteError {
  if (error instanceof SyntaxError) {
    return { status: 400, message: 'Request body must be valid JSON' };
  }

  const unauthenticated = unauthenticatedStatus(error);
  if (unauthenticated !== undefined) {
    return { status: unauthenticated, message: 'Unauthorized: valid session or API key required' };
  }

  if (isTemplateActionError(error)) {
    if ('permissionError' in error) {
      return { status: 403, message: error.permissionError };
    }
    const message = error.actionError;
    if (message === 'Template not found' || message === 'Project not found') {
      return { status: 404, message };
    }
    return { status: 400, message };
  }

  const issues = (error as { issues?: unknown })?.issues;
  if (Array.isArray(issues)) {
    return { status: 400, message: 'Template request validation failed' };
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '22P02') {
    return { status: 400, message: 'Template request contains an invalid UUID' };
  }

  if (!(error instanceof Error)) {
    return { status: 500, message: fallbackMessage };
  }

  const message = error.message;
  if (message.startsWith('Permission denied')) {
    return { status: 403, message };
  }
  if (message === 'Template not found' || message === 'Project not found') {
    return { status: 404, message };
  }
  if (message === 'No project statuses found') {
    return {
      status: 409,
      message: 'Project status configuration is missing. Configure project statuses before applying a template.',
    };
  }
  if (message.startsWith('Failed to create custom status')) {
    return {
      status: 409,
      message: 'Project status configuration could not be created. Check template status settings and try again.',
    };
  }

  return { status: 500, message: fallbackMessage };
}

export function templateErrorResponse(error: unknown, fallbackMessage: string): NextResponse {
  const mapped = templateRouteErrorFrom(error, fallbackMessage);
  return NextResponse.json({ error: mapped.message }, { status: mapped.status });
}
