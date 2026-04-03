/**
 * KB Article From Ticket Route
 * POST /api/v1/kb-articles/from-ticket/:ticketId - Create article from ticket
 */

import { ApiKbArticleController } from '@/lib/api/controllers/ApiKbArticleController';

const controller = new ApiKbArticleController();

export const POST = controller.createFromTicket();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
