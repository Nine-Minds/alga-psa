/**
 * Client Contract Lines API Routes
 * GET /api/v1/client-contract-lines - List client contract lines
 * POST /api/v1/client-contract-lines - Assign contract line to client
 *
 * This is the new endpoint for client contract lines.
 * Old /api/v1/client-contract-lines endpoint is deprecated but still supported.
 */

import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';

export const dynamic = 'force-dynamic';

const controller = new ApiContractLineController();

export const GET = controller.listClientContractLines();
export const POST = controller.assignContractLineToClient();
