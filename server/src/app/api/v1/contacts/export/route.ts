/**
 * Contact Export API Route
 * GET /api/v1/contacts/export - Export contacts to CSV or JSON
 */

import { ApiContactControllerV2 } from 'server/src/lib/api/controllers/ApiContactControllerV2';

const controller = new ApiContactControllerV2();

export const GET = controller.export();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';