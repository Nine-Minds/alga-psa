import { ZodSchema } from 'zod';
import type { Envelope } from '../types';
import type { SecretResolver } from '../utils/mappingResolver';

export type NodeTypeUI = {
  label: string;
  description?: string;
  category?: string;
  icon?: string;
};

export type NodeHandlerContext = {
  runId: string;
  stepPath: string;
  tenantId?: string | null;
  nowIso: () => string;
  logger?: { info: (msg: string, meta?: unknown) => void; warn: (msg: string, meta?: unknown) => void; error: (msg: string, meta?: unknown) => void };
  actions: {
    call: (actionId: string, version: number, args: any, options?: { idempotencyKey?: string }) => Promise<any>;
  };
  publishWait: (wait: { type: 'event' | 'human'; key?: string; eventName?: string; timeoutAt?: string; payload?: unknown }) => Promise<void>;
  resumeEvent?: { name: string; payload: unknown } | null;
  resumeError?: { category?: string; message?: string } | null;
  knex?: any;
  /**
   * Secret resolver for resolving $secret references in inputMapping.
   * Should be provided by the runtime when executing action.call steps.
   */
  secretResolver?: SecretResolver;
};

export type NodeTypeDef = {
  id: string;
  configSchema: ZodSchema<any>;
  /**
   * Optional schema describing the value produced by this node when it writes an output
   * (e.g. to `vars.<saveAs>`). This is used by the Workflow Designer to provide typed
   * autocomplete and mapping assistance.
   */
  outputSchema?: ZodSchema<any>;
  handler: (env: Envelope, config: any, ctx: NodeHandlerContext) => Promise<Envelope | { type: 'wait' } | { type: 'return' }>;
  ui?: NodeTypeUI;
  examples?: Record<string, unknown>;
  defaultRetry?: { maxAttempts: number; backoffMs: number; backoffMultiplier?: number; jitter?: boolean; retryOn?: string[] };
};

export class NodeTypeRegistry {
  private nodes = new Map<string, NodeTypeDef>();

  register(def: NodeTypeDef): void {
    if (!def.id) {
      throw new Error('NodeTypeRegistry.register requires id');
    }
    if (!def.configSchema) {
      throw new Error(`NodeType ${def.id} must have configSchema`);
    }
    if (!def.handler) {
      throw new Error(`NodeType ${def.id} must have handler`);
    }
    if (this.nodes.has(def.id)) {
      throw new Error(`NodeTypeRegistry already has ${def.id}`);
    }
    this.nodes.set(def.id, def);
  }

  get(id: string): NodeTypeDef | undefined {
    return this.nodes.get(id);
  }

  list(): NodeTypeDef[] {
    return Array.from(this.nodes.values());
  }
}

let registryInstance: NodeTypeRegistry | null = null;

export function getNodeTypeRegistry(): NodeTypeRegistry {
  if (!registryInstance) {
    registryInstance = new NodeTypeRegistry();
  }
  return registryInstance;
}
