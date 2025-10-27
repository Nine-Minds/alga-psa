/**
 * Contact Export API Route
 * GET /api/v1/contacts/export - Export contacts to CSV or JSON
 */

import { ApiContactController } from '@product/api/controllers/ApiContactController';

const controller = new ApiContactController();

export const GET = controller.export();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';