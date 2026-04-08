/**
 * Boards API Routes
 * GET /api/v1/boards - List boards
 * POST /api/v1/boards - Create board
 */

import { ApiBoardController } from '@/lib/api/controllers/ApiBoardController';

const controller = new ApiBoardController();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
