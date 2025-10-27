/**
 * Contacts API Routes
 * GET /api/v1/contacts - List contacts
 * POST /api/v1/contacts - Create contact
 */

import { ApiContactController } from '@product/api/controllers/ApiContactController';

const controller = new ApiContactController();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';