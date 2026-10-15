import type { TestProject } from 'vitest/node';
import { TestWorkflowEnvironment } from '@temporalio/testing';

// The SDK downloads the time-skipping test server (~85 MB) on first use and
// caches it in the temp directory. Fetching it here, before any test clock
// starts, keeps a slow download from being charged to whichever test happens
// to call createTimeSkipping() first.
const PROVISION_DEADLINE_MS = 10 * 60_000;

declare module 'vitest' {
  export interface ProvidedContext {
    temporalTimeSkippingServerProvisioned: boolean;
  }
}

export default async function provisionTimeSkippingServer(project: TestProject): Promise<void> {
  let deadline: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    deadline = setTimeout(
      () => reject(new Error(`Temporal time-skipping test server was not ready within ${PROVISION_DEADLINE_MS / 60_000} minutes`)),
      PROVISION_DEADLINE_MS,
    );
  });
  try {
    const environment = await Promise.race([TestWorkflowEnvironment.createTimeSkipping(), timedOut]);
    await environment.teardown();
  } finally {
    clearTimeout(deadline);
  }
  project.provide('temporalTimeSkippingServerProvisioned', true);
}
