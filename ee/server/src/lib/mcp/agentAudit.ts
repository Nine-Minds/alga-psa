import { createTenantKnex, runWithTenant } from '@/lib/db';

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
  offset?: number;
}

export interface AgentAuditPage {
  rows: unknown[];
  total: number;
}

/**
 * One page of the agent-action audit, newest first. Returns the page rows plus
 * the total row count so the caller can drive server-side pagination — an agent
 * can log hundreds of calls in a burst, so we never load the whole log.
 */
export async function exportAgentAudit(
  tenant: string,
  filter: AgentAuditExportFilter = {},
): Promise<AgentAuditPage> {
  return runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex(tenant);
    const scoped = () => {
      const q = knex('mcp_agent_audit').where({ tenant });
      return filter.agentId ? q.where({ agent_id: filter.agentId }) : q;
    };
    const limit = Math.max(1, Math.min(filter.limit ?? 25, 200));
    const offset = Math.max(0, filter.offset ?? 0);
    const countRow = await scoped().count<{ count: string }>('* as count').first();
    const rows = await scoped().orderBy('created_at', 'desc').limit(limit).offset(offset);
    return { rows, total: countRow ? Number(countRow.count) : 0 };
  });
}
