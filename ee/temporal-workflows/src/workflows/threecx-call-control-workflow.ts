import {
  CancellationScope,
  continueAsNew,
  defineSignal,
  isCancellation,
  log,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import { THREECX_CALL_CONTROL_STOP_SIGNAL } from '../lib/threecxCallControlConstants.js';

export interface ThreecxCallControlWorkflowInput {
  tenantId: string;
}

const { consumeThreecxCallControl } = proxyActivities<{
  consumeThreecxCallControl(input: ThreecxCallControlWorkflowInput): Promise<unknown>;
}>({
  startToCloseTimeout: '65 minutes',
  heartbeatTimeout: '1 minute',
  retry: {
    initialInterval: '1 minute',
    backoffCoefficient: 2,
    maximumInterval: '15 minutes',
  },
});

export const threecxCallControlStopSignal = defineSignal(THREECX_CALL_CONTROL_STOP_SIGNAL);

/**
 * One execution per tenant (id `threecx-callcontrol:<tenant>`) holding the
 * PBX Call Control socket. Each activity run lasts an hour, then the workflow
 * continues as new; `stop` cancels the in-flight run and ends the execution.
 */
export async function threecxCallControlWorkflow(input: ThreecxCallControlWorkflowInput): Promise<void> {
  let stopped = false;
  const scope = new CancellationScope();
  setHandler(threecxCallControlStopSignal, () => {
    stopped = true;
    scope.cancel();
  });

  try {
    await scope.run(() => consumeThreecxCallControl(input));
  } catch (error) {
    if (!(stopped && isCancellation(error))) throw error;
  }

  if (stopped) {
    log.info('3CX Call Control workflow stopped', { tenantId: input.tenantId });
    return;
  }
  await continueAsNew<typeof threecxCallControlWorkflow>(input);
}
