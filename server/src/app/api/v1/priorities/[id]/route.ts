/**
 * Priority by ID API Routes
 * GET /api/v1/priorities/:id - Get priority by ID
 */

import { ApiPriorityController } from '@/lib/api/controllers/ApiPriorityController';

const controller = new ApiPriorityController();

export const GET = controller.getById();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
