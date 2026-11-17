/**
 * Project Materials API Routes
 * GET /api/v1/projects/{id}/materials - List project materials
 * POST /api/v1/projects/{id}/materials - Add a material to a project
 */

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const controller = new ApiProjectController();

export const GET = controller.getMaterials();
export const POST = controller.addMaterial();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
