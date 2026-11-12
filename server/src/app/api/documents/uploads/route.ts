import type { NextRequest } from 'next/server';
import { createUploadHandler } from '@/lib/api/documentUploads/handlers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (request: NextRequest) => createUploadHandler(request);
