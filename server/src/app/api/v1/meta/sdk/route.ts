/**
 * SDK Generation API Route
 * GET /api/v1/meta/sdk - Generate and download SDKs for various programming languages
 */

import { NextRequest } from 'next/server';
import { MetadataController } from '../../../../../lib/api/controllers/MetadataController';

const controller = new MetadataController();

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  return controller.generateSdk(request, searchParams);
}