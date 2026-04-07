/**
 * Board by ID API Routes
 * GET /api/v1/boards/:id - Get board by ID
 * PUT /api/v1/boards/:id - Update board
 * DELETE /api/v1/boards/:id - Delete board
 */

import { ApiBoardController } from '@/lib/api/controllers/ApiBoardController';

const controller = new ApiBoardController();

export const GET = controller.getById();
export const PUT = controller.update();
export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
