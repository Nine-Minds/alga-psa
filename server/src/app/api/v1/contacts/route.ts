/**
 * Contacts API Routes
 * GET /api/v1/contacts - List contacts
 * POST /api/v1/contacts - Create contact
 */

import { ApiContactControllerV2 } from 'server/src/lib/api/controllers/ApiContactControllerV2';

const controller = new ApiContactControllerV2();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';