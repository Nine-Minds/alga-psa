/**
 * Project Material API Route
 * DELETE /api/v1/projects/{id}/materials/{materialId} - Remove a project material and restore its stock
 */

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const controller = new ApiProjectController();

export const DELETE = controller.deleteMaterial();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
