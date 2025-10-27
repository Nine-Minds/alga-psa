/**
 * Contact Statistics API Route
 * GET /api/v1/contacts/stats - Get contact statistics
 */

import { ApiContactController } from '@product/api/controllers/ApiContactController';

const controller = new ApiContactController();

export const GET = controller.stats();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';