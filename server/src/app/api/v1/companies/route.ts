/**
 * Companies API Routes
 * GET /api/v1/companies - List companies
 * POST /api/v1/companies - Create company
 */

import { ApiCompanyControllerV2 } from '@/lib/api/controllers/ApiCompanyControllerV2';

const controller = new ApiCompanyControllerV2();

export const GET = controller.list();

export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';