/**
 * GET /api/v1/meta/mcp-registry
 * Edition-aware MCP endpoint registry, consumed by the local stdio connector
 * and the remote MCP server. Requires a valid API key.
 */

import { ApiMetadataController } from '@/lib/api/controllers/ApiMetadataController';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const controller = new ApiMetadataController();

export const GET = controller.getMcpRegistry();
