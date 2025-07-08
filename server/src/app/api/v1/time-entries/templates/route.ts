/**
 * Time Entry Templates API Routes
 * GET /api/v1/time-entries/templates - List time entry templates
 * POST /api/v1/time-entries/templates - Create time entry template
 */

import { ApiTimeEntryController } from '@/lib/api/controllers/ApiTimeEntryController';

const controller = new ApiTimeEntryController();

export const GET = controller.getTemplates();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';