/**
 * Priorities API Routes
 * GET /api/v1/priorities - List priorities
 */

import { ApiPriorityController } from '@/lib/api/controllers/ApiPriorityController';

const controller = new ApiPriorityController();

export const GET = controller.list();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
