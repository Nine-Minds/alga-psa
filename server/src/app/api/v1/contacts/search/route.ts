/**
 * Contact Search API Route
 * GET /api/v1/contacts/search - Advanced contact search
 */

import { ApiContactControllerV2 } from 'server/src/lib/api/controllers/ApiContactControllerV2';

const controller = new ApiContactControllerV2();

export const GET = controller.search();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';