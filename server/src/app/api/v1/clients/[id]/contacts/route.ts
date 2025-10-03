/**
 * Client Contacts API Route
 * GET /api/v1/clients/{id}/contacts - List client contacts
 *
 * This is the new endpoint for client contacts.
 */

import { ApiClientController } from '@/lib/api/controllers/ApiClientController';

const controller = new ApiClientController();

export const GET = controller.getContacts();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
