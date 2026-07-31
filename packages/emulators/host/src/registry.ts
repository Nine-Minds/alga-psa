import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ActionDef, ControlRegistry, FaultDef, SeederDef, StateViewDef } from './types';

/** Error carrying the HTTP status the control API should respond with. */
export class ControlError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ControlError';
  }
}

interface Described {
  name: string;
  description: string;
  params?: { safeParse: (raw: unknown) => { success: true; data: unknown } | { success: false; error: { message: string } } };
}

function describe(def: Described): { name: string; description: string; paramsSchema: unknown } {
  return {
    name: def.name,
    description: def.description,
    paramsSchema: def.params ? zodToJsonSchema(def.params as never) : null,
  };
}

function parseParams<P>(def: { name: string; params?: { safeParse: (raw: unknown) => { success: boolean; data?: unknown; error?: { message: string } } } }, raw: unknown): P {
  if (!def.params) return undefined as P;
  const result = def.params.safeParse(raw ?? {});
  if (!result.success) {
    throw new ControlError(400, `Invalid params for "${def.name}": ${result.error?.message}`);
  }
  return result.data as P;
}

/**
 * Per-emulator control registry. Emulator packages fill it in `register()`;
 * the control API, CLI, and console are generated from its catalog.
 */
export class EmulatorControls implements ControlRegistry {
  private readonly actions = new Map<string, ActionDef<never>>();
  private readonly faults = new Map<string, FaultDef<never>>();
  private readonly stateViews = new Map<string, StateViewDef>();
  private readonly seeders = new Map<string, SeederDef<never>>();
  /** Fault name → the params it was armed with. */
  private readonly armed = new Map<string, unknown>();

  action<P>(def: ActionDef<P>): void {
    this.add(this.actions, def as ActionDef<never>, 'action');
  }

  fault<P>(def: FaultDef<P>): void {
    this.add(this.faults, def as FaultDef<never>, 'fault');
  }

  stateView(def: StateViewDef): void {
    this.add(this.stateViews, def, 'state view');
  }

  seeder<P>(def: SeederDef<P>): void {
    this.add(this.seeders, def as SeederDef<never>, 'seeder');
  }

  private add<T extends { name: string }>(map: Map<string, T>, def: T, kind: string): void {
    if (map.has(def.name)) {
      throw new Error(`Duplicate ${kind} "${def.name}"`);
    }
    map.set(def.name, def);
  }

  async runAction(name: string, rawParams: unknown): Promise<unknown> {
    const def = this.actions.get(name);
    if (!def) throw new ControlError(404, `Unknown action "${name}"`);
    return def.run(parseParams(def, rawParams));
  }

  async armFault(name: string, rawParams: unknown): Promise<void> {
    const def = this.faults.get(name);
    if (!def) throw new ControlError(404, `Unknown fault "${name}"`);
    const params = parseParams(def, rawParams);
    await def.arm(params as never);
    this.armed.set(name, params ?? null);
  }

  async disarmFault(name: string): Promise<void> {
    const def = this.faults.get(name);
    if (!def) throw new ControlError(404, `Unknown fault "${name}"`);
    await def.disarm();
    this.armed.delete(name);
  }

  async disarmAll(): Promise<void> {
    for (const name of [...this.armed.keys()]) {
      await this.disarmFault(name);
    }
  }

  readState(name: string): unknown {
    const def = this.stateViews.get(name);
    if (!def) throw new ControlError(404, `Unknown state view "${name}"`);
    return def.get();
  }

  async runSeeder(name: string, rawParams: unknown): Promise<unknown> {
    const def = this.seeders.get(name);
    if (!def) throw new ControlError(404, `Unknown seeder "${name}"`);
    return def.run(parseParams(def, rawParams));
  }

  armedFaults(): Array<{ name: string; params: unknown }> {
    return [...this.armed.entries()].map(([name, params]) => ({ name, params }));
  }

  catalog(): {
    actions: ReturnType<typeof describe>[];
    faults: Array<ReturnType<typeof describe> & { armed: boolean }>;
    stateViews: Array<{ name: string; description: string }>;
    seeders: ReturnType<typeof describe>[];
  } {
    return {
      actions: [...this.actions.values()].map(describe),
      faults: [...this.faults.values()].map((def) => ({ ...describe(def), armed: this.armed.has(def.name) })),
      stateViews: [...this.stateViews.values()].map(({ name, description }) => ({ name, description })),
      seeders: [...this.seeders.values()].map(describe),
    };
  }
}
