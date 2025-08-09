/**
 * SDK Generation API Route
 * GET /api/v1/meta/sdk - Generate and download SDKs for various programming languages
 */

import { NextRequest } from 'next/server';
import { ApiMetadataController } from '@/lib/api/controllers/ApiMetadataController';

export const dynamic = 'force-dynamic';

const controller = new ApiMetadataController();

export const GET = controller.generateSdk();