/**
 * Client Contract Line by ID API Routes
 * DELETE /api/v1/client-contract-lines/{id} - Unassign contract line from client
 *
 * This is the new endpoint for client contract line management.
 * Old /api/v1/client-contract-lines/{id} endpoint is deprecated but still supported.
 */

import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';

const controller = new ApiContractLineController();

export const DELETE = controller.unassignContractLineFromClient();
