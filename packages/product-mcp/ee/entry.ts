// EE implementation surface for the remote MCP server + governance.
// Resolves to ee/server/src/lib/mcp/* via the @ee alias in EE builds.
export { handleMcpJsonRpc } from '@ee/lib/mcp/jsonRpcServer';
export { resolvePublicBaseUrl } from '@ee/lib/mcp/baseUrl';
export {
  createAgent,
  listAgents,
  setAgentActive,
  deleteAgent,
  addTrustedIdp,
  listTrustedIdps,
  listAllActiveIssuers,
  listAssignableRoles,
  getIdpSuggestions,
} from '@ee/lib/mcp/agents';
export { exportAgentAudit } from '@ee/lib/mcp/agentAudit';
export { authenticateMcpAdmin } from '@ee/lib/mcp/adminAuth';
export {
  buildConnectAuthUrl,
  completeConnectCallback,
  listPlatformProviders,
} from '@ee/lib/mcp/connectOAuth';
export type { PlatformProvider, ConnectIdentity, ConnectStart, ConnectProvider } from '@ee/lib/mcp/connectOAuth';

// OAuth 2.1 Authorization Server (plan 2026-06-27-mcp-authorization-server).
export {
  buildAuthServerMetadata,
  prepareAuthorize,
  completeAuthorize,
  handleToken,
  handleRevoke,
} from '@ee/lib/mcp/oauth/authServer';
export type { AuthorizePlan, AuthorizeDecision, TokenResult } from '@ee/lib/mcp/oauth/authServer';
export { getPublicJwks } from '@ee/lib/mcp/oauth/keys';
export { listConnectedClients } from '@ee/lib/mcp/oauth/clients';
export { revokeGrant } from '@ee/lib/mcp/oauth/grants';
export { isAuthServerEnabled } from '@ee/lib/mcp/oauth/config';
