import type { TestProject } from 'vitest/node';
import { TestWorkflowEnvironment } from '@temporalio/testing';

// The SDK downloads the time-skipping test server (~85 MB) on first use and
// caches it in the temp directory. Fetching it here, before any test clock
// starts, keeps a slow download from being charged to whichever test happens
// to call createTimeSkipping() first.
const PROVISION_DEADLINE_MS = 10 * 60_000;

// temporal.download rate-limits the tarball per source address, and CI runners
// share those: a 429 there failed a whole suite on correct code. The fetch is
// the only transport in this setup, so retry it inside the deadline above and
// let anything that is not transport-shaped fail on the first attempt. A body
// cut off mid-transfer surfaces from the SDK's Rust fetcher as "error decoding
// response body: error reading a body from connection: end of file before
// message length reached".
const RETRY_BACKOFFS_MS = [5_000, 15_000, 45_000];
const TRANSIENT_FETCH =
  /too many requests|HTTP status (?:client|server) error|error sending request|error (?:decoding response body|reading a body from connection)|connection (?:reset|closed)|(?:unexpected )?end of file|ECONNRESET|EAI_AGAIN|socket hang up/i;

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
    for (let attempt = 0; ; attempt += 1) {
      try {
        const environment = await Promise.race([TestWorkflowEnvironment.createTimeSkipping(), timedOut]);
        await environment.teardown();
        break;
      } catch (error) {
        const backoff = RETRY_BACKOFFS_MS[attempt];
        if (backoff === undefined || !(error instanceof Error) || !TRANSIENT_FETCH.test(error.message)) throw error;
        console.warn(`Temporal test server download failed (${error.message}); retrying in ${backoff / 1_000}s`);
        await Promise.race([new Promise((resolve) => setTimeout(resolve, backoff)), timedOut]);
      }
    }
  } finally {
    clearTimeout(deadline);
  }
  project.provide('temporalTimeSkippingServerProvisioned', true);
}
