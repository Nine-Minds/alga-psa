/**
 * GET /api/v1/meta/health
 * Get API health status and service availability
 */

import { NextRequest } from 'next/server';
import { ApiMetadataControllerV2 } from '@/lib/api/controllers/ApiMetadataControllerV2';

const controller = new ApiMetadataControllerV2();

export const GET = controller.getHealth();