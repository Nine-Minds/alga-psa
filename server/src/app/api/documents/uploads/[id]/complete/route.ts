import type { NextRequest } from 'next/server';
import { completeUploadHandler } from '@/lib/api/documentUploads/handlers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return completeUploadHandler(request, (await params).id);
}
