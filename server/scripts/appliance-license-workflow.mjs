import crypto from 'node:crypto';
import { Client, Connection } from '@temporalio/client';

export async function runLicenseWorkflow({ workflowType, input, connect = Connection.connect }) {
  const connection = await connect({ address: process.env.TEMPORAL_ADDRESS || 'temporal-frontend.msp.svc.cluster.local:7233' });
  try {
    const client = new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE || 'default' });
    const handle = await client.workflow.start(workflowType, {
      args: [input], taskQueue: process.env.TEMPORAL_TASK_QUEUE || 'tenant-workflows',
      workflowId: `${workflowType}-${crypto.randomUUID()}`,
    });
    return await handle.result();
  } finally { await connection.close().catch(() => {}); }
}

export async function readStdin(stream = process.stdin) {
  let value = '';
  for await (const chunk of stream) value += chunk;
  return JSON.parse(value || '{}');
}

export function workflowError(error) {
  const cause = error?.cause || error;
  return { ok: false, code: cause?.type || cause?.failure?.applicationFailureInfo?.type || 'workflow_failed', error: cause?.message || String(error) };
}
