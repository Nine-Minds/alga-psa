#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EmulatorHost, loadScenarioDir } from '@alga-psa/emulator-host';
import { SUITE_EMULATORS } from './index';

/**
 * One-command entry point: every emulator on its default port, the console
 * on 9500, bundled scenarios loaded. Configure through env vars:
 *
 *   ALGASIM_CONTROL_PORT       control API + console port (default 9500)
 *   ALGASIM_PORT_<ID>          vendor-surface port per emulator, e.g.
 *                              ALGASIM_PORT_MSGRAPH, ALGASIM_PORT_SMTP_SINK
 *   ALGASIM_SCENARIOS          scenario directory (default: bundled scenarios/)
 *   ALGASIM_SEED               PRNG seed (default 1)
 */
function packageRoot(): string {
  if (typeof __dirname !== 'undefined') {
    return join(__dirname, '..');
  }
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

const ports: Record<string, number> = {};
for (const emulator of SUITE_EMULATORS) {
  const envName = `ALGASIM_PORT_${emulator.id.toUpperCase().replace(/-/g, '_')}`;
  const value = process.env[envName];
  if (value !== undefined) {
    ports[emulator.id] = Number(value);
  }
}

const scenarioDir = process.env.ALGASIM_SCENARIOS ?? join(packageRoot(), 'scenarios');

const host = new EmulatorHost({
  emulators: SUITE_EMULATORS,
  controlPort: Number(process.env.ALGASIM_CONTROL_PORT ?? 9500),
  ports,
  seed: Number(process.env.ALGASIM_SEED ?? 1),
  scenarios: existsSync(scenarioDir) ? loadScenarioDir(scenarioDir) : [],
});

host.start().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

const shutdown = async () => {
  await host.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
