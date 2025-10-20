/**
 * Client Contract Lines API Routes (DEPRECATED)
 * GET /api/v1/client-contract-lines - List client contract lines
 * POST /api/v1/client-contract-lines - Assign contract line to client
 *
 * @deprecated This endpoint is deprecated. Use /api/v1/client-contract-lines instead.
 *
 * This endpoint is maintained for backward compatibility during the client → client migration.
 * Please migrate to /api/v1/client-contract-lines as this endpoint will be removed in a future version.
 */

import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';

export const dynamic = 'force-dynamic';

const controller = new ApiContractLineController();

export const GET = controller.listClientContractLines();
export const POST = controller.assignContractLineToClient();
