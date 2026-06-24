// EE implementation surface for the remote MCP server + governance.
// Resolves to ee/server/src/lib/mcp/* via the @ee alias in EE builds.
export { handleMcpJsonRpc } from '@ee/lib/mcp/jsonRpcServer';
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
