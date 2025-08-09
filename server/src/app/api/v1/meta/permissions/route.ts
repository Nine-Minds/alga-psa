/**
 * GET /api/v1/meta/permissions
 * List all API permissions and access requirements
 */

import { NextRequest } from 'next/server';
import { ApiMetadataController } from '@/lib/api/controllers/ApiMetadataController';

export const dynamic = 'force-dynamic';

const controller = new ApiMetadataController();

export const GET = controller.getPermissions();