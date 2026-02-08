export interface ReadinessWorkflowInput {
  echo?: string;
}

export interface ReadinessWorkflowResult {
  ok: true;
  echo: string;
}

/**
 * Minimal deterministic workflow used by readiness gates.
 * It does not depend on activities, database, or external services.
 */
export async function readinessWorkflow(
  input: ReadinessWorkflowInput = {}
): Promise<ReadinessWorkflowResult> {
  return {
    ok: true,
    echo: input.echo ?? 'ready',
  };
}
