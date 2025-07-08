/**
 * Permission Categories API Route
 * GET /api/v1/permissions/categories - Get permission categories
 */

import { ApiPermissionController } from '@/lib/api/controllers/ApiPermissionController';

const controller = new ApiPermissionController();

export const GET = controller.getCategories();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';