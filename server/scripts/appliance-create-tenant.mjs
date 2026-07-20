#!/usr/bin/env node

/**
 * Appliance bootstrap: create the initial tenant + admin user by running the
 * same Temporal tenantCreationWorkflow the hosted environment uses.
 *
 * Plain .mjs on purpose: this runs inside the production image at first boot,
 * where workspace packages (@alga-psa/*) have no built dist/ and tsx has
 * repeatedly broken on runtime resolution (three prior incidents in
 * create-tenant.ts). This script imports ONLY @temporalio/client — a published
 * npm dependency of ee/server that is always present in node_modules — and
 * needs no transpilation.
 *
 * Inputs (env):
 *   INITIAL_TENANT_NAME, INITIAL_ADMIN_FIRST_NAME, INITIAL_ADMIN_LAST_NAME,
 *   INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD  — required
 *   INITIAL_TENANT_ID   — optional pre-minted tenant id (install-code redeem)
 *   TEMPORAL_ADDRESS    — default temporal-frontend.msp.svc.cluster.local:7233
 *   TEMPORAL_NAMESPACE  — default "default"
 *   TEMPORAL_TASK_QUEUE — default "tenant-workflows"
 *   BOOTSTRAP_TEMPORAL_WAIT_TIMEOUT_SECONDS — how long to retry connecting to
 *     the Temporal frontend (default 600; it deploys concurrently with this job)
 */

import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

const log = (message) => {
  console.log(`[${new Date().toISOString().replace('T', ' ').slice(0, 19)}] ${message}`);
};

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    log(`ERROR: ${name} is required to create the initial appliance tenant`);
    process.exit(1);
  }
  return value;
};

const tenantName = requireEnv('INITIAL_TENANT_NAME');
const firstName = requireEnv('INITIAL_ADMIN_FIRST_NAME');
const lastName = requireEnv('INITIAL_ADMIN_LAST_NAME');
const email = requireEnv('INITIAL_ADMIN_EMAIL');
const password = requireEnv('INITIAL_ADMIN_PASSWORD');
const tenantId = process.env.INITIAL_TENANT_ID || undefined;

const address = process.env.TEMPORAL_ADDRESS || 'temporal-frontend.msp.svc.cluster.local:7233';
const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
const taskQueue = process.env.TEMPORAL_TASK_QUEUE || 'tenant-workflows';

// Fixed workflow id so bootstrap-job retries attach to the same execution
// instead of minting duplicate tenants.
const workflowId = 'appliance-initial-tenant';

async function connectWithRetry() {
  const timeoutSeconds = Number(process.env.BOOTSTRAP_TEMPORAL_WAIT_TIMEOUT_SECONDS || 600);
  const startedAt = Date.now();
  for (;;) {
    try {
      return await Connection.connect({ address });
    } catch (error) {
      if (Date.now() - startedAt >= timeoutSeconds * 1000) {
        log(`ERROR: Temporal frontend did not become reachable within ${timeoutSeconds}s at ${address}`);
        log(`ERROR: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
      log(`Temporal frontend is not ready yet at ${address} - retrying`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

const connection = await connectWithRetry();
const client = new Client({ connection, namespace });

const input = {
  tenantName,
  adminUser: { firstName, lastName, email, password },
  companyName: tenantName,
  clientName: tenantName,
  productCode: 'psa',
  emailProvider: 'smtp',
  billingSource: 'manual',
  tenantId,
  skipCustomerTracking: true,
  skipWelcomeEmail: true,
};

let handle;
try {
  handle = await client.workflow.start('tenantCreationWorkflow', {
    args: [input],
    taskQueue,
    workflowId,
    // Re-running the bootstrap after a failed attempt starts a fresh run; after
    // a successful one it attaches to the completed execution instead of
    // minting a duplicate tenant.
    workflowIdReusePolicy: 'ALLOW_DUPLICATE_FAILED_ONLY',
    workflowExecutionTimeout: '1h',
    workflowRunTimeout: '30m',
  });
  log(`Started tenantCreationWorkflow (workflowId=${workflowId}, taskQueue=${taskQueue})`);
} catch (error) {
  if (error instanceof WorkflowExecutionAlreadyStartedError) {
    log(`tenantCreationWorkflow already started (workflowId=${workflowId}); attaching to it`);
    handle = client.workflow.getHandle(workflowId);
  } else {
    throw error;
  }
}

try {
  // The temporal-worker deploys concurrently with this job and may still be
  // starting; Temporal queues the workflow until a worker polls the task queue.
  log('Waiting for tenant creation workflow to complete...');
  const result = await handle.result();
  log(`Tenant created successfully (tenantId=${result.tenantId}, adminUserId=${result.adminUserId}${tenantId ? ', adopted from INITIAL_TENANT_ID' : ''})`);
} catch (error) {
  log(`ERROR: Tenant creation workflow failed: ${error instanceof Error ? error.message : error}`);
  log(`ERROR: Inspect the execution in Temporal (workflowId=${workflowId}) for details; it can be retried by re-running the bootstrap job.`);
  process.exit(1);
} finally {
  await connection.close().catch(() => {});
}
