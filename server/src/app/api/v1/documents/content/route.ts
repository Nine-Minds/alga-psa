import { ApiDocumentController } from 'server/src/lib/api/controllers/ApiDocumentController';

const controller = new ApiDocumentController();

/**
 * GET /api/v1/documents/content - an entity's attachments as native MCP content blocks.
 * Called by the `read_attachment` MCP tool (hosted server and stdio connector), not through call_api_endpoint.
 */
export const GET = controller.readContent();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
