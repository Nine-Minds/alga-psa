/**
 * Time Entry Templates API Routes
 * GET /api/v1/time-entries/templates - List time entry templates
 * POST /api/v1/time-entries/templates - Create time entry template
 */

import { ApiTimeEntryControllerV2 } from '@/lib/api/controllers/ApiTimeEntryControllerV2';

const controller = new ApiTimeEntryControllerV2();

export const GET = controller.getTemplates();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';