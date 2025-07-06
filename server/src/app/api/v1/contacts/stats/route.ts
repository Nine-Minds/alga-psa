/**
 * Contact Statistics API Route
 * GET /api/v1/contacts/stats - Get contact statistics
 */

import { ApiContactControllerV2 } from 'server/src/lib/api/controllers/ApiContactControllerV2';

const controller = new ApiContactControllerV2();

export const GET = controller.stats();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';