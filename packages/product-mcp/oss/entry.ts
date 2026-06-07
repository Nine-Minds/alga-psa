// CE stub. The remote MCP server + governance are Enterprise-only; this surface
// is bundled into CE builds in place of the EE implementation so no EE source
// ships in CE. Route shells also gate on isEnterpriseEdition() before calling.
import { NextResponse } from 'next/server';

const enterpriseOnly = () =>
  NextResponse.json({ error: 'The MCP server is an Enterprise feature.' }, { status: 404 });

export async function handleMcpJsonRpc(_req: unknown) {
  return enterpriseOnly();
}

export async function createAgent(_input: unknown): Promise<never> {
  throw new Error('MCP agent provisioning is an Enterprise feature.');
}
export async function listAgents(_tenant: string): Promise<unknown[]> {
  return [];
}
export async function setAgentActive(): Promise<void> {
  /* no-op in CE */
}
export async function addTrustedIdp(_input: unknown): Promise<never> {
  throw new Error('MCP is an Enterprise feature.');
}
export async function listTrustedIdps(_tenant: string): Promise<unknown[]> {
  return [];
}
export async function listAllActiveIssuers(): Promise<string[]> {
  return [];
}
export async function listAssignableRoles(_tenant: string): Promise<unknown[]> {
  return [];
}
export async function getIdpSuggestions(_tenant: string): Promise<Record<string, unknown>> {
  return {};
}
export async function exportAgentAudit(_tenant: string, _filter?: unknown): Promise<unknown[]> {
  return [];
}
export async function authenticateMcpAdmin(_req: unknown): Promise<null> {
  return null;
}
