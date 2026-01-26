import { ZodSchema } from 'zod';
import type { RetryPolicy } from '../types';

export type ActionId = string;

export type ActionIdempotency =
  | { mode: 'engineProvided' }
  | { mode: 'actionProvided'; key: (input: any, ctx: ActionContext) => string };

export type ActionUI = {
  label: string;
  description?: string;
  category?: string;
  icon?: string;
};

export type ActionDef<I, O> = {
  id: ActionId;
  version: number;
  inputSchema: ZodSchema<I>;
  outputSchema: ZodSchema<O>;
  sideEffectful: boolean;
  retryHint?: RetryPolicy;
  idempotency: ActionIdempotency;
  ui?: ActionUI;
  examples?: Record<string, unknown>;
  handler: (input: I, ctx: ActionContext) => Promise<O>;
};

export type ActionContext = {
  runId: string;
  stepPath: string;
  tenantId?: string | null;
  idempotencyKey: string;
  attempt: number;
  logger?: { info: (msg: string, meta?: unknown) => void; warn: (msg: string, meta?: unknown) => void; error: (msg: string, meta?: unknown) => void };
  nowIso: () => string;
  env: Record<string, unknown>;
  knex?: any;
};

export type ActionMeta = {
  id: string;
  version: number;
  sideEffectful: boolean;
  retryHint?: RetryPolicy;
  idempotency: { mode: 'engineProvided' | 'actionProvided' };
  ui?: ActionUI;
  inputSchema: ZodSchema<any>;
  outputSchema: ZodSchema<any>;
  examples?: Record<string, unknown>;
};

export class ActionRegistry {
  private actions = new Map<string, ActionDef<any, any>>();

  register<I, O>(def: ActionDef<I, O>): void {
    if (!def.id || !def.version) {
      throw new Error('ActionRegistry.register requires id and version');
    }
    if (!def.inputSchema || !def.outputSchema) {
      throw new Error(`Action ${def.id}@${def.version} must include inputSchema and outputSchema`);
    }
    if (def.sideEffectful && !def.idempotency) {
      throw new Error(`Action ${def.id}@${def.version} must define idempotency strategy`);
    }

    const key = this.key(def.id, def.version);
    if (this.actions.has(key)) {
      throw new Error(`ActionRegistry already has ${key}`);
    }
    this.actions.set(key, def);
  }

  get(id: string, version: number): ActionDef<any, any> | undefined {
    return this.actions.get(this.key(id, version));
  }

  list(): ActionMeta[] {
    return Array.from(this.actions.values()).map((action) => ({
      id: action.id,
      version: action.version,
      sideEffectful: action.sideEffectful,
      retryHint: action.retryHint,
      idempotency: { mode: action.idempotency.mode },
      ui: action.ui,
      inputSchema: action.inputSchema,
      outputSchema: action.outputSchema,
      examples: action.examples
    }));
  }

  listById(id: string): ActionDef<any, any>[] {
    return Array.from(this.actions.values()).filter((action) => action.id === id);
  }

  private key(id: string, version: number): string {
    return `${id}@${version}`;
  }
}

let registryInstance: ActionRegistry | null = null;

export function getActionRegistryV2(): ActionRegistry {
  if (!registryInstance) {
    registryInstance = new ActionRegistry();
  }
  return registryInstance;
}
