import { compileExpression } from '../expressionEngine';
import type { WorkflowDefinition, Step } from '../types';

export type WorkflowSimulationTraceEntry = {
  stepId: string;
  type: string;
  outcome: 'executed' | 'stubbed' | 'skipped' | 'error' | 'would-wait';
  evaluatedInput?: unknown;
  branchTaken?: 'then' | 'else' | 'try' | 'catch';
  savedAs?: string;
  message?: string;
};

export type WorkflowSimulationResult = {
  status: 'completed' | 'paused-at-wait' | 'failed';
  trace: WorkflowSimulationTraceEntry[];
  finalVars: Record<string, unknown>;
  invocations: Array<{ stepId: string; actionId?: string; input: unknown }>;
  errors: Array<{ stepId?: string; message: string }>;
  warnings: Array<{ stepId?: string; message: string }>;
};

export async function simulateWorkflowDefinition(params: {
  definition: WorkflowDefinition;
  payload?: unknown;
}): Promise<WorkflowSimulationResult> {
  const trace: WorkflowSimulationTraceEntry[] = [];
  const invocations: WorkflowSimulationResult['invocations'] = [];
  const warnings: WorkflowSimulationResult['warnings'] = [];
  const errors: WorkflowSimulationResult['errors'] = [];
  const finalVars: Record<string, unknown> = {};

  const walk = async (steps: Step[], ctx: { payload: unknown; vars: Record<string, unknown> }): Promise<'completed' | 'paused-at-wait' | 'failed'> => {
    for (const step of steps) {
      if (step.type === 'action.call') {
        const actionId = (step.config as { actionId?: string } | undefined)?.actionId;
        const input = (step.config as { inputMapping?: Record<string, { $expr: string }> } | undefined)?.inputMapping ?? {};
        invocations.push({ stepId: step.id, actionId, input });
        trace.push({ stepId: step.id, type: step.type, outcome: 'stubbed', evaluatedInput: input });
        continue;
      }

      if (step.type === 'control.if') {
        try {
          const condition = await compileExpression(step.condition).evaluate({ payload: ctx.payload, vars: ctx.vars });
          const branch = condition ? 'then' : 'else';
          trace.push({ stepId: step.id, type: step.type, outcome: 'executed', branchTaken: branch });
          const childStatus = await walk(condition ? step.then : (step.else ?? []), ctx);
          if (childStatus !== 'completed') return childStatus;
          continue;
        } catch (error) {
          errors.push({ stepId: step.id, message: error instanceof Error ? error.message : 'Condition evaluation failed' });
          trace.push({ stepId: step.id, type: step.type, outcome: 'error', message: error instanceof Error ? error.message : 'Condition evaluation failed' });
          return 'failed';
        }
      }

      if (step.type === 'event.wait' || step.type === 'time.wait' || step.type === 'human.task' || step.type === 'control.callWorkflow') {
        trace.push({ stepId: step.id, type: step.type, outcome: 'would-wait' });
        warnings.push({ stepId: step.id, message: `Simulation stopped at ${step.type}` });
        return 'paused-at-wait';
      }

      if (step.type === 'transform.assign') {
        trace.push({ stepId: step.id, type: step.type, outcome: 'executed' });
        continue;
      }

      if (step.type === 'control.return') {
        trace.push({ stepId: step.id, type: step.type, outcome: 'skipped' });
        return 'completed';
      }

      trace.push({ stepId: step.id, type: step.type, outcome: 'executed' });
    }

    return 'completed';
  };

  const status = await walk(params.definition.steps, { payload: params.payload ?? {}, vars: finalVars });
  return { status, trace, finalVars, invocations, errors, warnings };
}
