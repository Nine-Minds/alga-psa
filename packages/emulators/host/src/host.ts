import express from 'express';
import type { Server } from 'node:http';
import { seededRng, VirtualClock } from './clock';
import { buildControlApp } from './controlApi';
import { ControlError, EmulatorControls } from './registry';
import { registerTransportFaults, TransportFaultState, transportFaultMiddleware } from './transportFaults';
import type { Scenario } from './scenario';
import {
  DebouncedSnapshotWriter,
  readSnapshot,
  type HostSnapshot,
  type SnapshotCapableCore,
} from './statePersistence';
import type { EmulatorCore, EmulatorPackage, EmulatorServer, HostEnv } from './types';

export interface EmulatorInstance {
  pkg: EmulatorPackage;
  core: EmulatorCore;
  controls: EmulatorControls;
  transport: TransportFaultState;
  /** Actual bound port of the vendor surface (known after start()). */
  port: number;
}

export interface HostOptions {
  emulators: EmulatorPackage[];
  /** Control API + console port. Default 9500; 0 binds an ephemeral port. */
  controlPort?: number;
  /** Vendor-surface port overrides by emulator id; 0 binds an ephemeral port. */
  ports?: Record<string, number>;
  /** PRNG seed. Same seed, same run. Default 1. */
  seed?: number;
  /** Named scenarios runnable via the control API and console. */
  scenarios?: Scenario[];
  /** Snapshot seeded state here so a container restart does not wipe it. */
  stateFile?: string;
  /** Capture control calls into a replayable scenario document. */
  recordScenario?: boolean;
  log?: HostEnv['log'];
}

export interface RecordedStep {
  emulator: string;
  kind: 'seed' | 'action' | 'arm' | 'disarm';
  name: string;
  params?: unknown;
}

function defaultLog(message: string, extra?: Record<string, unknown>): void {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stderr.write(`[algasim] ${message}${suffix}\n`);
}

function listen(app: express.Express, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => resolve(server));
    server.on('error', reject);
  });
}

function boundPort(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Server has no bound TCP port');
  }
  return address.port;
}

/**
 * Loads emulator packages, serves each vendor surface on its own port with
 * transport-fault middleware in front, and serves the uniform control API.
 */
export class EmulatorHost {
  readonly clock = new VirtualClock();
  readonly env: HostEnv;
  readonly scenarios = new Map<string, Scenario>();
  private readonly instances = new Map<string, EmulatorInstance>();
  private servers: Server[] = [];
  private customServers: EmulatorServer[] = [];
  /** Actual bound control port (known after start()). */
  controlPort = 0;
  /** Control calls captured since the host started, when recording is on. */
  readonly recordedSteps: RecordedStep[] = [];
  private snapshotWriter: DebouncedSnapshotWriter | null = null;

  constructor(private readonly options: HostOptions) {
    if (options.emulators.length === 0) {
      throw new Error('EmulatorHost requires at least one emulator package');
    }
    this.env = {
      clock: this.clock,
      rng: seededRng(options.seed ?? 1),
      log: options.log ?? defaultLog,
    };
    for (const pkg of options.emulators) {
      if (this.instances.has(pkg.id)) {
        throw new Error(`Duplicate emulator id "${pkg.id}"`);
      }
      if (Boolean(pkg.wire) === Boolean(pkg.serve)) {
        throw new Error(`Emulator "${pkg.id}" must provide exactly one of wire() or serve()`);
      }
      const core = pkg.createCore(this.env);
      const controls = new EmulatorControls();
      const transport = new TransportFaultState();
      if (pkg.wire) {
        // Transport faults sit in front of HTTP surfaces only; a serve()
        // emulator owns its protocol end to end.
        registerTransportFaults(controls, transport);
      }
      pkg.register(controls, core);
      this.instances.set(pkg.id, { pkg, core, controls, transport, port: 0 });
    }
    for (const scenario of options.scenarios ?? []) {
      if (this.scenarios.has(scenario.name)) {
        throw new Error(`Duplicate scenario name "${scenario.name}"`);
      }
      this.scenarios.set(scenario.name, scenario);
    }
    if (options.stateFile) {
      this.restoreFromStateFile(options.stateFile);
      this.snapshotWriter = new DebouncedSnapshotWriter(options.stateFile, () => this.buildSnapshot());
    }
  }

  private restoreFromStateFile(path: string): void {
    const snapshot = readSnapshot(path);
    if (!snapshot) return;

    this.clock.advance(snapshot.clockOffsetMs);
    for (const [id, state] of Object.entries(snapshot.emulators)) {
      const instance = this.instances.get(id);
      const core = instance?.core as SnapshotCapableCore | undefined;
      if (!core?.restore) continue;
      try {
        core.restore(state);
      } catch (error) {
        this.env.log('state restore failed', {
          emulator: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.env.log('restored emulator state', { stateFile: path, savedAt: snapshot.savedAt });
  }

  private buildSnapshot(): HostSnapshot {
    const emulators: Record<string, unknown> = {};
    for (const [id, instance] of this.instances) {
      const core = instance.core as SnapshotCapableCore;
      if (typeof core.snapshot === 'function') {
        emulators[id] = core.snapshot();
      }
    }
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      clockOffsetMs: this.clock.offset,
      emulators,
    };
  }

  /** Called by the control API after any state-mutating request. */
  persistState(): void {
    this.snapshotWriter?.schedule();
  }

  recordStep(step: RecordedStep): void {
    if (this.options.recordScenario) {
      this.recordedSteps.push(step);
    }
  }

  get recordingEnabled(): boolean {
    return Boolean(this.options.recordScenario);
  }

  scenario(name: string): Scenario {
    const scenario = this.scenarios.get(name);
    if (!scenario) {
      throw new ControlError(404, `Unknown scenario "${name}"`);
    }
    return scenario;
  }

  get emulators(): EmulatorInstance[] {
    return [...this.instances.values()];
  }

  instance(id: string): EmulatorInstance {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new ControlError(404, `Unknown emulator "${id}"`);
    }
    return instance;
  }

  /** Reset one emulator: core state, armed faults, and transport faults. */
  async reset(id: string): Promise<void> {
    const instance = this.instance(id);
    await instance.controls.disarmAll();
    instance.transport.clear();
    instance.core.reset();
  }

  async start(): Promise<{ controlPort: number; ports: Record<string, number> }> {
    if (this.servers.length > 0) {
      throw new Error('EmulatorHost is already started');
    }
    const ports: Record<string, number> = {};
    for (const instance of this.instances.values()) {
      const requestedPort = this.options.ports?.[instance.pkg.id] ?? instance.pkg.defaultPort;
      if (instance.pkg.wire) {
        const app = express();
        app.use(transportFaultMiddleware(instance.transport, this.env.rng));
        const router = express.Router();
        instance.pkg.wire(router, instance.core, this.env);
        app.use(router);
        const server = await listen(app, requestedPort);
        this.servers.push(server);
        instance.port = boundPort(server);
      } else {
        const server = await instance.pkg.serve!(instance.core, requestedPort, this.env);
        this.customServers.push(server);
        instance.port = server.port;
      }
      ports[instance.pkg.id] = instance.port;
      this.env.log(`${instance.pkg.id} vendor surface listening`, { port: instance.port });
    }
    const controlServer = await listen(buildControlApp(this), this.options.controlPort ?? 9500);
    this.servers.push(controlServer);
    this.controlPort = boundPort(controlServer);
    this.env.log('control API listening', { port: this.controlPort });
    return { controlPort: this.controlPort, ports };
  }

  async stop(): Promise<void> {
    // Last chance to persist: a debounced write may still be pending.
    this.snapshotWriter?.flush();
    await Promise.all([
      ...this.servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.closeAllConnections();
            server.close((err) => (err ? reject(err) : resolve()));
          }),
      ),
      ...this.customServers.map((server) => server.close()),
    ]);
    this.servers = [];
    this.customServers = [];
  }
}
