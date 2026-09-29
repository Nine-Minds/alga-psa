/**
 * Email Templates API Routes
 * GET /api/v1/email/templates - List system and tenant email templates
 */

import { ApiEmailTemplateController } from '@/lib/api/controllers/ApiEmailTemplateController';

const controller = new ApiEmailTemplateController();

export const GET = controller.list();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
