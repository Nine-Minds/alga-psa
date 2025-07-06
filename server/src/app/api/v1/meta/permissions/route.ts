/**
 * GET /api/v1/meta/permissions
 * List all API permissions and access requirements
 */

import { NextRequest } from 'next/server';
import { ApiMetadataControllerV2 } from '@/lib/api/controllers/ApiMetadataControllerV2';

const controller = new ApiMetadataControllerV2();

export const GET = controller.getPermissions();