/**
 * Company Contacts API Route
 * GET /api/v1/companies/{id}/contacts - List company contacts
 */

import { ApiCompanyControllerV2 } from '@/lib/api/controllers/ApiCompanyControllerV2';

const controller = new ApiCompanyControllerV2();

export const GET = controller.getContacts();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';