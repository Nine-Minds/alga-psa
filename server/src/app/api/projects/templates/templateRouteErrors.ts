import { NextResponse } from 'next/server';

type TemplateRouteError = {
  status: number;
  message: string;
};

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
