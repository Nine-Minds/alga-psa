/**
 * Email Template by Name API Routes
 * GET /api/v1/email/templates/{name} - Get a template with its tenant override
 * PUT /api/v1/email/templates/{name} - Create or update the tenant override
 * DELETE /api/v1/email/templates/{name} - Drop the override for one language
 */

import { ApiEmailTemplateController } from '@/lib/api/controllers/ApiEmailTemplateController';

const controller = new ApiEmailTemplateController();

export const GET = controller.getByName();

export const PUT = controller.updateByName();

export const DELETE = controller.deleteByName();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
