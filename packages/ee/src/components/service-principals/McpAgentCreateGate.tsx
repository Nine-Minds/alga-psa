'use client';

/**
 * CE stub for the MCP agent create gate
 * (ee/server/src/components/service-principals/McpAgentCreateGate.tsx, resolved via the
 * edition-swapped `@enterprise` alias). In Community Edition it adds no limit: it just renders the
 * create control enabled.
 */
import type { ReactNode } from 'react';

export interface McpAgentCreateGateProps {
  refreshKey?: unknown;
  children: (state: { disabled: boolean }) => ReactNode;
}

export function McpAgentCreateGate({ children }: McpAgentCreateGateProps) {
  return <>{children({ disabled: false })}</>;
}

export default McpAgentCreateGate;
