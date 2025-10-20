/**
 * Client Contract Line by ID API Routes (DEPRECATED)
 * DELETE /api/v1/client-contract-lines/{id} - Unassign contract line from client
 *
 * @deprecated This endpoint is deprecated. Use /api/v1/client-contract-lines/{id} instead.
 *
 * This endpoint is maintained for backward compatibility during the client → client migration.
 * Please migrate to /api/v1/client-contract-lines/{id} as this endpoint will be removed in a future version.
 */

import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';

const controller = new ApiContractLineController();

export const DELETE = controller.unassignContractLineFromClient();
