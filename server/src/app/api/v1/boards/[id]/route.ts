/**
 * Board by ID API Routes
 * GET /api/v1/boards/:id - Get board by ID
 */

import { ApiBoardController } from '@/lib/api/controllers/ApiBoardController';

const controller = new ApiBoardController();

export const GET = controller.getById();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
