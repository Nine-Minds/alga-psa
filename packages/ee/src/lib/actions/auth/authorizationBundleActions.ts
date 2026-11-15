'use server';
// CE stub for the EE authorization simulator. Declared structurally: a CE stub must not depend on the
// enterprise code it stands in for. Seat-technician effective access needs the simulator, so it is unavailable in CE.
type SimulationDecision = {
  allowed: boolean;
  reasonCodes: string[];
  explanations: Array<{ code: string; kind: string; messageKey: string; params: { resource?: string; action?: string; requiredAction?: string } }>;
};
type SimulationResult =
  | { ok: true; data: { draft: SimulationDecision; published: SimulationDecision } }
  | { ok: false; error: { code: string; message: string } };

export async function runAuthorizationBundleSimulationAction(_input: {
  bundleId?: string; principalUserId: string; resourceType: string; action: string; resourceId?: string;
}): Promise<SimulationResult> {
  throw new Error('The authorization simulator is an Enterprise Edition feature.');
}

export async function listAuthorizationSimulationRecordsAction(_input: {
  resourceType: string; search?: string;
}): Promise<Array<{ id: string; label: string; subLabel?: string }>> {
  throw new Error('The authorization simulator is an Enterprise Edition feature.');
}
