import type { NextRequest } from 'next/server';
import {
  abortUploadHandler,
  getUploadHandler,
  putChunkHandler,
} from '@/lib/api/documentUploads/handlers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Context) {
  return putChunkHandler(request, (await params).id);
}

export async function HEAD(request: NextRequest, { params }: Context) {
  return getUploadHandler(request, (await params).id, { head: true });
}

export async function GET(request: NextRequest, { params }: Context) {
  return getUploadHandler(request, (await params).id, { head: false });
}

export async function DELETE(request: NextRequest, { params }: Context) {
  return abortUploadHandler(request, (await params).id);
}
