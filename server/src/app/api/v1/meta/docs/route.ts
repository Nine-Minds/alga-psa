/**
 * GET /api/v1/meta/docs
 * Serve interactive API documentation (Swagger UI)
 */

import { NextRequest } from 'next/server';
import { ApiMetadataControllerV2 } from '@/lib/api/controllers/ApiMetadataControllerV2';

export const dynamic = 'force-dynamic';

const controller = new ApiMetadataControllerV2();

export const GET = controller.getDocs();