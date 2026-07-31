import { NextResponse } from 'next/server';
import { createImportPreview } from '@/lib/imports/importActions';
import { importErrorResponse } from '../importRouteErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const result = await createImportPreview(formData);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] /import/preview', error);
    return importErrorResponse(error, 'Failed to create import preview');
  }
}
