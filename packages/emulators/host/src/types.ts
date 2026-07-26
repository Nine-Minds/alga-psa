import type { Router } from 'express';
import type { z } from 'zod';

/** Time source injected into every emulator core. Never read wall time directly. */
export interface Clock {
  now(): Date;
}

/** Host-provided environment an emulator core is constructed with. */
export interface HostEnv {
  clock: Clock;
  /** Seeded PRNG in [0, 1). Use instead of Math.random() so runs are reproducible. */
  rng(): number;
  log(message: string, extra?: Record<string, unknown>): void;
}

/** Minimum contract an emulator core must satisfy. */
export interface EmulatorCore {
  /** Drop all state and return to the just-started condition. */
  reset(): void;
}

/**
 * A named, schema-described control operation. Actions mutate emulator state
 * on demand (expire a token, deliver a queued notification, force a conflict).
 */
export interface ActionDef<P = unknown> {
  name: string;
  description: string;
  params?: z.ZodType<P, z.ZodTypeDef, any>;
  run(params: P): unknown | Promise<unknown>;
}

/**
 * A toggleable misbehavior. Arming changes how the vendor surface responds
 * until the fault is disarmed or the emulator is reset.
 */
export interface FaultDef<P = unknown> {
  name: string;
  description: string;
  params?: z.ZodType<P, z.ZodTypeDef, any>;
  arm(params: P): void | Promise<void>;
  disarm(): void | Promise<void>;
}

/** A read-only projection of emulator state for inspection. */
export interface StateViewDef {
  name: string;
  description: string;
  get(): unknown;
}

/** A named entity factory for seeding test data. */
export interface SeederDef<P = unknown> {
  name: string;
  description: string;
  params?: z.ZodType<P, z.ZodTypeDef, any>;
  run(params: P): unknown | Promise<unknown>;
}

/**
 * Collects an emulator's control declarations. Everything registered here is
 * automatically exposed through the control API, the CLI, and the console UI;
 * emulators never implement those clients themselves.
 */
export interface ControlRegistry {
  action<P>(def: ActionDef<P>): void;
  fault<P>(def: FaultDef<P>): void;
  stateView(def: StateViewDef): void;
  seeder<P>(def: SeederDef<P>): void;
}

/**
 * The unit the host loads. One package per emulated vendor service.
 *
 * Core stays pure (in-process state machine, injectable into unit tests);
 * `wire` mounts the vendor's HTTP protocol; `register` declares controls.
 */
export interface EmulatorPackage<C extends EmulatorCore = EmulatorCore> {
  /** Stable identifier used in control routes and CLI commands, e.g. "qbo". */
  id: string;
  displayName: string;
  /** Default port for the vendor surface. Overridable per host instance. */
  defaultPort: number;
  createCore(env: HostEnv): C;
  wire(router: Router, core: C, env: HostEnv): void;
  register(reg: ControlRegistry, core: C): void;
}
