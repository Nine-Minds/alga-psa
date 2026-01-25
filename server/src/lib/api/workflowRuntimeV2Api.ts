import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

type StatusError = Error & { status?: number; statusCode?: number; details?: unknown };

export function handleWorkflowV2ApiError(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: 'Invalid request', details: error.errors }, { status: 400 });
  }

  const err = error as StatusError;
  const status = typeof err.status === 'number'
    ? err.status
    : typeof err.statusCode === 'number'
      ? err.statusCode
      : undefined;
  const message = err instanceof Error ? err.message : 'Unexpected error';

  if (typeof status === 'number') {
    return NextResponse.json({ error: message, ...(err.details ? { details: err.details } : {}) }, { status });
  }

  if (message.toLowerCase().includes('unauthorized')) {
    return NextResponse.json({ error: message }, { status: 401 });
  }

  if (message.toLowerCase().includes('not found')) {
    return NextResponse.json({ error: message }, { status: 404 });
  }

  return NextResponse.json({ error: message, ...(err.details ? { details: err.details } : {}) }, { status: 500 });
}
