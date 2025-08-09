/**
 * User Password API Route
 * PUT /api/v1/users/[id]/password - Change user password
 */

import { ApiUserController } from '@/lib/api/controllers/ApiUserController';

const controller = new ApiUserController();

export const PUT = controller.changePassword();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';