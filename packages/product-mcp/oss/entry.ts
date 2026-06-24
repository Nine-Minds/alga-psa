// CE stub. The remote MCP server + governance are Enterprise-only; this surface
// is bundled into CE builds in place of the EE implementation so no EE source
// ships in CE. Route shells also gate on isEnterpriseEdition() before calling.
import { NextResponse } from 'next/server';

const enterpriseOnly = () =>
  NextResponse.json({ error: 'The MCP server is an Enterprise feature.' }, { status: 404 });

// Mirrors @ee/lib/mcp/adminAuth's McpAdminContext so the route shells type-check
// identically against either edition's seam entry.
export interface McpAdminContext {
  tenant: string;
  userId: string | null;
}

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
export async function exportAgentAudit(_tenant: string, _filter?: unknown): Promise<{ rows: unknown[]; total: number }> {
  return { rows: [], total: 0 };
}
export async function authenticateMcpAdmin(_req: unknown): Promise<McpAdminContext | null> {
  return null;
}

// "Connect with Microsoft/Google" + hosted platform providers (EE-only). These
// shapes mirror @ee/lib/mcp/connectOAuth so the route shells type-check against
// either edition's seam entry.
export interface PlatformProvider {
  provider: 'microsoft' | 'google';
  label: string;
  issuer: string | null;
  available: boolean;
}
export interface ConnectIdentity {
  provider: 'microsoft' | 'google';
  issuer: string;
  subject: string;
  label: string;
}
export interface ConnectStart {
  authUrl: string;
  stateCookie: { name: string; value: string; maxAgeSeconds: number };
}

export async function listPlatformProviders(_tenant: string): Promise<PlatformProvider[]> {
  return [];
}
export async function buildConnectAuthUrl(_params: unknown): Promise<ConnectStart> {
  throw new Error('MCP is an Enterprise feature.');
}
export async function completeConnectCallback(_params: unknown): Promise<ConnectIdentity> {
  throw new Error('MCP is an Enterprise feature.');
}
