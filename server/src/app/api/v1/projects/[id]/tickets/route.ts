/**
 * Project Ticket Links API Routes
 * GET /api/v1/projects/{id}/tickets - List project ticket links
 * POST /api/v1/projects/{id}/tickets - Create project ticket link
 */

import { ApiProjectControllerV2 } from '@/lib/api/controllers/ApiProjectControllerV2';

const controller = new ApiProjectControllerV2();

export const GET = controller.getTickets();
// Note: POST for creating ticket links would need a separate method in the controller

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';