import { getSecret } from '@alga-psa/core/secrets';

export type WorkflowReplayKeys = { activeKeyId: string; keys: Record<string, string> };

/** Retain previous entries while any persisted invocation still uses them. */
export async function loadWorkflowReplayKeys(): Promise<WorkflowReplayKeys> {
  const configured = await getSecret('workflow_replay_keys', 'WORKFLOW_REPLAY_KEYS');
  if (configured) {
    try {
      const ring = JSON.parse(configured);
      if (!ring || typeof ring.activeKeyId !== 'string' || !ring.keys || typeof ring.keys !== 'object' || Array.isArray(ring.keys)) throw new Error();
      const entries = Object.entries(ring.keys);
      if (!entries.length || entries.some(([id, value]) => !/^[a-zA-Z0-9_.-]{1,64}$/.test(id) || typeof value !== 'string' || !value)) throw new Error();
      if (!Object.hasOwn(ring.keys, ring.activeKeyId)) throw new Error();
      return { activeKeyId: ring.activeKeyId, keys: ring.keys };
    } catch {
      throw new Error('Invalid workflow replay key configuration');
    }
  }
  // This secret is already mandatory in Temporal startup validation. Operators
  // moving to an explicit key ring must retain this value under "nextauth".
  const fallback = await getSecret('nextauth_secret', 'NEXTAUTH_SECRET');
  if (!fallback) throw new Error('Workflow replay encryption key is required before executing an action');
  return { activeKeyId: 'nextauth', keys: { nextauth: fallback } };
}

export function workflowReplayKey(keys: WorkflowReplayKeys, keyId: unknown): string {
  if (typeof keyId !== 'string' || !Object.hasOwn(keys.keys, keyId)) throw new Error('Workflow replay key is unavailable');
  return keys.keys[keyId];
}
