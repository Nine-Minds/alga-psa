export type WorkflowDisplayError = {
  message: string;
  category?: string | null;
  at?: string | null;
  technicalMessage?: string | null;
  actionId?: string | null;
  stepPath?: string | null;
};

type WorkflowRunLike = {
  node_path?: string | null;
  error_json?: Record<string, unknown> | null;
};

type WorkflowRunStepLike = {
  step_path: string;
  status: string;
  error_json?: Record<string, unknown> | null;
};

type WorkflowActionInvocationLike = {
  step_path: string;
  action_id: string;
  error_message?: string | null;
};

const getErrorJsonMessage = (errorJson?: Record<string, unknown> | null): string | null => {
  const message = errorJson?.message;
  return typeof message === 'string' && message.trim().length > 0 ? message : null;
};

export const buildStepDisplayError = (
  step: WorkflowRunStepLike | null | undefined,
  stepInvocations: WorkflowActionInvocationLike[]
): WorkflowDisplayError | null => {
  if (!step) return null;

  const failedInvocation = stepInvocations.find((invocation) =>
    typeof invocation.error_message === 'string' && invocation.error_message.trim().length > 0
  );
  const stepMessage = getErrorJsonMessage(step.error_json);

  if (failedInvocation?.error_message) {
    return {
      message: failedInvocation.error_message,
      category: failedInvocation.action_id,
      technicalMessage: stepMessage && stepMessage !== failedInvocation.error_message ? stepMessage : null,
      actionId: failedInvocation.action_id,
      stepPath: step.step_path,
    };
  }

  if (stepMessage) {
    return {
      message: stepMessage,
      category: typeof step.error_json?.category === 'string' ? step.error_json.category : null,
      at: typeof step.error_json?.at === 'string' ? step.error_json.at : null,
      stepPath: step.step_path,
    };
  }

  return null;
};

export const buildRunDisplayError = (
  run: WorkflowRunLike | null,
  steps: WorkflowRunStepLike[],
  invocations: WorkflowActionInvocationLike[]
): WorkflowDisplayError | null => {
  const runMessage = getErrorJsonMessage(run?.error_json);
  const preferredStepPath = run?.node_path ?? steps.find((step) => step.status === 'FAILED')?.step_path ?? null;
  const preferredStep = preferredStepPath
    ? steps.find((step) => step.step_path === preferredStepPath) ?? null
    : null;
  const preferredStepError = buildStepDisplayError(
    preferredStep,
    preferredStepPath ? invocations.filter((invocation) => invocation.step_path === preferredStepPath) : []
  );

  if (preferredStepError) {
    return {
      ...preferredStepError,
      technicalMessage: runMessage && runMessage !== preferredStepError.message
        ? runMessage
        : preferredStepError.technicalMessage,
    };
  }

  const failedInvocation = invocations.find((invocation) =>
    typeof invocation.error_message === 'string' && invocation.error_message.trim().length > 0
  );
  if (failedInvocation?.error_message) {
    return {
      message: failedInvocation.error_message,
      category: failedInvocation.action_id,
      technicalMessage: runMessage && runMessage !== failedInvocation.error_message ? runMessage : null,
      actionId: failedInvocation.action_id,
      stepPath: failedInvocation.step_path,
    };
  }

  if (runMessage) {
    return {
      message: runMessage,
      category: typeof run?.error_json?.category === 'string' ? run.error_json.category : null,
      at: typeof run?.error_json?.at === 'string' ? run.error_json.at : null,
      stepPath: typeof run?.error_json?.nodePath === 'string' ? run.error_json.nodePath : null,
    };
  }

  return null;
};
