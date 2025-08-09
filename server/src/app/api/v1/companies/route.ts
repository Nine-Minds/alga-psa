/**
 * Companies API Routes
 * GET /api/v1/companies - List companies
 * POST /api/v1/companies - Create company
 */

import { ApiCompanyController } from '@/lib/api/controllers/ApiCompanyController';

const controller = new ApiCompanyController();

export const GET = controller.list();

export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';