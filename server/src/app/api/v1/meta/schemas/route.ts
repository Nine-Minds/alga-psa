/**
 * GET /api/v1/meta/schemas
 * List all API schemas and data models
 */

import { NextRequest } from 'next/server';
import { ApiMetadataControllerV2 } from '@/lib/api/controllers/ApiMetadataControllerV2';

export const dynamic = 'force-dynamic';

const controller = new ApiMetadataControllerV2();

export const GET = controller.getSchemas();