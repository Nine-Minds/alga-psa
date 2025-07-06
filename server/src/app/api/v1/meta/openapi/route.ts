/**
 * GET /api/v1/meta/openapi
 * Generate OpenAPI 3.0 specification for the entire API
 */

import { NextRequest } from 'next/server';
import { ApiMetadataControllerV2 } from '@/lib/api/controllers/ApiMetadataControllerV2';

const controller = new ApiMetadataControllerV2();

export const GET = controller.getOpenApiSpec();