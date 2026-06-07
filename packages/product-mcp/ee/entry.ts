// EE implementation surface for the remote MCP server + governance.
// Resolves to ee/server/src/lib/mcp/* via the @ee alias in EE builds.
export { handleMcpJsonRpc } from '@ee/lib/mcp/jsonRpcServer';
export {
  createAgent,
  listAgents,
  setAgentActive,
  addTrustedIdp,
  listTrustedIdps,
  listAllActiveIssuers,
} from '@ee/lib/mcp/agents';
export { exportAgentAudit } from '@ee/lib/mcp/agentAudit';
export { authenticateMcpAdmin } from '@ee/lib/mcp/adminAuth';
