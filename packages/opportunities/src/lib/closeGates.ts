import type { Knex } from 'knex';

export interface OpportunityCloseGateResult {
  ok: boolean;
  reason?: string;
}

export interface OpportunityCloseGate {
  id: string;
  canClose(
    trx: Knex.Transaction,
    tenant: string,
    opportunityId: string,
  ): Promise<OpportunityCloseGateResult>;
}

const closeGates = new Map<string, OpportunityCloseGate>();

export function registerOpportunityCloseGate(gate: OpportunityCloseGate): void {
  closeGates.set(gate.id, gate);
}

export async function runOpportunityCloseGates(
  trx: Knex.Transaction,
  tenant: string,
  opportunityId: string,
): Promise<void> {
  for (const gate of closeGates.values()) {
    const result = await gate.canClose(trx, tenant, opportunityId);
    if (!result.ok) {
      throw new Error(result.reason || 'Opportunity cannot be closed');
    }
  }
}

let enterpriseGatesLoaded = false;

export async function ensureEnterpriseOpportunityCloseGatesRegistered(): Promise<void> {
  if (enterpriseGatesLoaded) return;
  const enterprise = await import('@enterprise/lib/opportunities/closeGateProvider');
  const gates = await enterprise.getEnterpriseOpportunityCloseGates();
  for (const gate of gates) registerOpportunityCloseGate(gate);
  enterpriseGatesLoaded = true;
}

/** Test-only reset for isolated registry behavior. */
export function resetOpportunityCloseGatesForTests(): void {
  closeGates.clear();
  enterpriseGatesLoaded = false;
}
