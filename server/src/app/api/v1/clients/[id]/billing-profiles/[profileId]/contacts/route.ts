/**
 * Billing Profile Contacts API Routes
 * GET /api/v1/clients/{id}/billing-profiles/{profileId}/contacts - list profile contacts
 * PUT /api/v1/clients/{id}/billing-profiles/{profileId}/contacts - replace profile contacts
 */

import { ApiClientController } from '@/lib/api/controllers/ApiClientController';

const controller = new ApiClientController();

export const GET = controller.getBillingProfileContacts();

export const PUT = controller.setBillingProfileContacts();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
