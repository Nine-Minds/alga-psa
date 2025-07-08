/**
 * Company Contacts API Route
 * GET /api/v1/companies/{id}/contacts - List company contacts
 */

import { ApiCompanyController } from '@/lib/api/controllers/ApiCompanyController';

const controller = new ApiCompanyController();

export const GET = controller.getContacts();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';