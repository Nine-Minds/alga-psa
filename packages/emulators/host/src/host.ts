import express from 'express';
import type { Server } from 'node:http';
import { seededRng, VirtualClock } from './clock';
import { buildControlApp } from './controlApi';
import { ControlError, EmulatorControls } from './registry';
import { registerTransportFaults, TransportFaultState, transportFaultMiddleware } from './transportFaults';
import type { Scenario } from './scenario';
import type { EmulatorCore, EmulatorPackage, HostEnv } from './types';

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
  log?: HostEnv['log'];
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
  /** Actual bound control port (known after start()). */
  controlPort = 0;

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
      const core = pkg.createCore(this.env);
      const controls = new EmulatorControls();
      const transport = new TransportFaultState();
      registerTransportFaults(controls, transport);
      pkg.register(controls, core);
      this.instances.set(pkg.id, { pkg, core, controls, transport, port: 0 });
    }
    for (const scenario of options.scenarios ?? []) {
      if (this.scenarios.has(scenario.name)) {
        throw new Error(`Duplicate scenario name "${scenario.name}"`);
      }
      this.scenarios.set(scenario.name, scenario);
    }
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
      const app = express();
      app.use(transportFaultMiddleware(instance.transport, this.env.rng));
      const router = express.Router();
      instance.pkg.wire(router, instance.core, this.env);
      app.use(router);
      const requestedPort = this.options.ports?.[instance.pkg.id] ?? instance.pkg.defaultPort;
      const server = await listen(app, requestedPort);
      this.servers.push(server);
      instance.port = boundPort(server);
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
    await Promise.all(
      this.servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.closeAllConnections();
            server.close((err) => (err ? reject(err) : resolve()));
          }),
      ),
    );
    this.servers = [];
  }
}
