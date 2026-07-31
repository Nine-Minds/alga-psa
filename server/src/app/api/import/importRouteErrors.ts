import { NextResponse } from 'next/server';

type ImportRouteError = {
  status: number;
  message: string;
};

function importRouteErrorFrom(error: unknown, fallbackMessage: string): ImportRouteError {
  if (error instanceof SyntaxError) {
    return { status: 400, message: 'Request body contains invalid JSON.' };
  }

  if (!(error instanceof Error)) {
    return { status: 500, message: fallbackMessage };
  }

  const message = error.message;

  if (message === 'No authenticated user found') {
    return { status: 401, message: 'Unauthorized' };
  }
  if (message.startsWith('Permission denied')) {
    return { status: 403, message: 'Permission denied for import/export settings' };
  }
  if (message === 'No tenant found') {
    return { status: 400, message: 'Tenant context is required' };
  }
  if (message === 'Import job not found') {
    return { status: 404, message };
  }
  if (message === 'Import source not found') {
    return { status: 404, message };
  }
  if (
    message === 'importJobId is required' ||
    message === 'Missing importSourceId' ||
    message === 'No file provided' ||
    message === 'Import files must be 100 MB or smaller.' ||
    message.startsWith('Unsupported file format') ||
    message.startsWith('Unsupported MIME type') ||
    message.startsWith('Invalid field mapping entry') ||
    message === 'Field mapping is required to prepare a preview' ||
    message === 'No worksheets found in XLSX file'
  ) {
    return { status: 400, message };
  }
  if (
    message === 'Import job is not ready for approval' ||
    message === 'Import job is already queued for processing'
  ) {
    return { status: 409, message };
  }

  return { status: 500, message: fallbackMessage };
}

export function importErrorResponse(error: unknown, fallbackMessage: string): NextResponse {
  const mapped = importRouteErrorFrom(error, fallbackMessage);
  return NextResponse.json({ error: mapped.message }, { status: mapped.status });
}
