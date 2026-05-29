/**
 * Unified Search API Route
 * GET /api/v1/search - Full-text search across all indexed business records
 */

import { ApiSearchController } from 'server/src/lib/api/controllers/ApiSearchController';

const controller = new ApiSearchController();

export const GET = controller.search();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
