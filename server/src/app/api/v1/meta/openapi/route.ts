/**
 * GET /api/v1/meta/openapi
 * Generate OpenAPI 3.0 specification for the entire API
 */

import { NextRequest } from 'next/server';
import { ApiMetadataController } from '@/lib/api/controllers/ApiMetadataController';

export const dynamic = 'force-dynamic';

const controller = new ApiMetadataController();

export const GET = controller.getOpenApiSpec();