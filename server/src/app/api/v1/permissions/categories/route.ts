/**
 * Permission Categories API Route
 * GET /api/v1/permissions/categories - Get permission categories
 */

import { ApiPermissionControllerV2 } from '@/lib/api/controllers/ApiPermissionControllerV2';

const controller = new ApiPermissionControllerV2();

export const GET = controller.getCategories();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';