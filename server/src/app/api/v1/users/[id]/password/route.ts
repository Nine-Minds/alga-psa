/**
 * User Password API Route
 * PUT /api/v1/users/[id]/password - Change user password
 */

import { ApiUserControllerV2 } from '@/lib/api/controllers/ApiUserControllerV2';

const controller = new ApiUserControllerV2();

export const PUT = controller.changePassword();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';