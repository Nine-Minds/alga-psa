/**
 * GET /api/v1/meta/endpoints
 * List all available API endpoints with metadata
 */

import { NextRequest } from 'next/server';
import { ApiMetadataController } from '@/lib/api/controllers/ApiMetadataController';

export const dynamic = 'force-dynamic';

const controller = new ApiMetadataController();

export const GET = controller.getEndpoints();