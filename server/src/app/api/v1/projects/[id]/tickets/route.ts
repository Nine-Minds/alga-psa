/**
 * Project Ticket Links API Routes
 * GET /api/v1/projects/{id}/tickets - List project ticket links
 * POST /api/v1/projects/{id}/tickets - Create project ticket link
 */

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const controller = new ApiProjectController();

export const GET = controller.getTickets();
// Note: POST for creating ticket links would need a separate method in the controller

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';