/**
 * GET /api/v1/meta/docs
 * Serve interactive API documentation (Swagger UI)
 */

import { NextRequest } from 'next/server';
import { ApiMetadataController } from '@/lib/api/controllers/ApiMetadataController';

export const dynamic = 'force-dynamic';

const controller = new ApiMetadataController();

export const GET = controller.getDocs();