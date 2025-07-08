/**
 * SDK Generation API Route
 * GET /api/v1/meta/sdk - Generate and download SDKs for various programming languages
 */

import { NextRequest } from 'next/server';
import { ApiMetadataControllerV2 } from '@/lib/api/controllers/ApiMetadataControllerV2';

export const dynamic = 'force-dynamic';

const controller = new ApiMetadataControllerV2();

export const GET = controller.generateSdk();