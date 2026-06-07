import { createTenantKnex, runWithTenant } from '../db';

/** One agent tool invocation, recorded for the exportable agent-action audit. */
export interface AgentAuditEntry {
  tenant: string;
  agentId: string;
  tool: string;
  arguments?: unknown;
  ok: boolean;
  statusCode?: number | null;
  decision?: 'allow' | 'deny' | 'error';
  resultSummary?: string | null;
}

const MAX_SUMMARY = 2000;

export async function writeAgentAudit(entry: AgentAuditEntry): Promise<void> {
  try {
    await runWithTenant(entry.tenant, async () => {
      const { knex } = await createTenantKnex(entry.tenant);
      await knex('mcp_agent_audit').insert({
        tenant: entry.tenant,
        agent_id: entry.agentId,
        tool: entry.tool,
        arguments: entry.arguments === undefined ? null : JSON.stringify(entry.arguments),
        ok: entry.ok,
        status_code: entry.statusCode ?? null,
        decision: entry.decision ?? (entry.ok ? 'allow' : 'error'),
        result_summary: entry.resultSummary ? entry.resultSummary.slice(0, MAX_SUMMARY) : null,
      });
    });
  } catch {
    // Audit must never break the tool call; failures are swallowed (best-effort).
  }
}

export interface AgentAuditExportFilter {
  agentId?: string;
  limit?: number;
}

export async function exportAgentAudit(
  tenant: string,
  filter: AgentAuditExportFilter = {},
): Promise<unknown[]> {
  return runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex(tenant);
    let q = knex('mcp_agent_audit').where({ tenant }).orderBy('created_at', 'desc');
    if (filter.agentId) q = q.where({ agent_id: filter.agentId });
    q = q.limit(Math.max(1, Math.min(filter.limit ?? 1000, 10000)));
    return q;
  });
}
