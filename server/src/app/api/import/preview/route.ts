import { NextResponse } from 'next/server';
import { createImportPreview } from '@/lib/actions/import-actions/importActions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const result = await createImportPreview(formData);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] /import/preview', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create import preview' },
      { status: 500 }
    );
  }
}
