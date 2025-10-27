/**
 * Contact Search API Route
 * GET /api/v1/contacts/search - Advanced contact search
 */

import { ApiContactController } from '@product/api/controllers/ApiContactController';

const controller = new ApiContactController();

export const GET = controller.search();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';