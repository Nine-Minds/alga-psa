/**
 * Client Merge Preview API Route
 * POST /api/v1/clients/{id}/merge/preview - dry run of a merge; writes nothing
 */

import { ApiClientController } from '@/lib/api/controllers/ApiClientController';

const controller = new ApiClientController();

export const POST = controller.mergePreview();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
