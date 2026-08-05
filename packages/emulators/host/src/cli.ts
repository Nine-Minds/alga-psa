#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { EmulatorHost } from './host';
import { loadScenarioDir, loadScenarioFile } from './scenarioFiles';
import type { EmulatorPackage } from './types';

const DEFAULT_URL = process.env.ALGASIM_URL ?? 'http://localhost:9500';

async function controlRequest(url: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  const payload = (await response.json()) as { ok: boolean; result?: unknown; error?: string };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? `Control API responded ${response.status}`);
  }
  return payload.result ?? null;
}

function parseParamsOption(raw: string | undefined): unknown {
  if (raw === undefined) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`--params must be valid JSON, got: ${raw}`);
  }
}

function printResult(result: unknown): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function run(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await fn();
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    }
  };
}

async function importEmulatorPackage(specifier: string): Promise<EmulatorPackage> {
  // Path specifiers resolve against the caller's cwd, not this file's location.
  const resolved = specifier.startsWith('.') || specifier.startsWith('/')
    ? pathToFileURL(resolve(specifier)).href
    : specifier;
  const mod = (await import(resolved)) as { default?: EmulatorPackage; emulator?: EmulatorPackage };
  const pkg = mod.default ?? mod.emulator;
  if (!pkg || typeof pkg.id !== 'string' || typeof pkg.createCore !== 'function') {
    throw new Error(`Module "${specifier}" does not export an EmulatorPackage (default or named "emulator")`);
  }
  return pkg;
}

const program = new Command('algasim').description('AlgaPSA emulator suite');

program
  .command('serve')
  .description('Start the emulator host')
  .requiredOption('-m, --module <specifier...>', 'emulator package module specifier(s) to load')
  .option('--control-port <port>', 'control API port (0 = ephemeral)', '9500')
  .option('--port <id=port...>', 'vendor-surface port override(s), e.g. --port qbo=9601')
  .option('--seed <n>', 'PRNG seed for reproducible runs', '1')
  .option('--scenarios <dir>', 'directory of scenario .yaml files to load')
  .action(async (opts: { module: string[]; controlPort: string; port?: string[]; seed: string; scenarios?: string }) => {
    const ports: Record<string, number> = {};
    for (const entry of opts.port ?? []) {
      const [id, port] = entry.split('=');
      if (!id || port === undefined || Number.isNaN(Number(port))) {
        throw new Error(`Invalid --port "${entry}" — expected <emulator-id>=<port>`);
      }
      ports[id] = Number(port);
    }
    const emulators = await Promise.all(opts.module.map(importEmulatorPackage));
    const host = new EmulatorHost({
      emulators,
      controlPort: Number(opts.controlPort),
      ports,
      seed: Number(opts.seed),
      scenarios: opts.scenarios ? loadScenarioDir(opts.scenarios) : [],
    });
    await host.start();
    const shutdown = async () => {
      await host.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

const urlOption = ['-u, --url <url>', 'control API base URL', DEFAULT_URL] as const;

program
  .command('catalog')
  .description('Show the full catalog of emulators, actions, faults, views, and seeders')
  .option(...urlOption)
  .action((opts: { url: string }) => run(async () => printResult(await controlRequest(opts.url, 'GET', '/control/catalog')))());

const clock = program.command('clock').description('Inspect or advance the shared virtual clock');
clock
  .command('show')
  .option(...urlOption)
  .action((opts: { url: string }) => run(async () => printResult(await controlRequest(opts.url, 'GET', '/control/clock')))());
clock
  .command('advance <duration>')
  .description('Advance the clock, e.g. "32d", "4h30m", "500ms"')
  .option(...urlOption)
  .action((duration: string, opts: { url: string }) =>
    run(async () => printResult(await controlRequest(opts.url, 'POST', '/control/clock/advance', { duration })))(),
  );

program
  .command('reset <emulator>')
  .description('Reset an emulator: state, armed faults, transport faults')
  .option(...urlOption)
  .action((emulator: string, opts: { url: string }) =>
    run(async () => printResult(await controlRequest(opts.url, 'POST', `/control/${emulator}/reset`)))(),
  );

program
  .command('action <emulator> <name>')
  .description('Run an emulator action')
  .option('-p, --params <json>', 'action params as JSON')
  .option(...urlOption)
  .action((emulator: string, name: string, opts: { params?: string; url: string }) =>
    run(async () =>
      printResult(await controlRequest(opts.url, 'POST', `/control/${emulator}/actions/${name}`, parseParamsOption(opts.params))),
    )(),
  );

program
  .command('arm <emulator> <fault>')
  .description('Arm a fault')
  .option('-p, --params <json>', 'fault params as JSON')
  .option(...urlOption)
  .action((emulator: string, fault: string, opts: { params?: string; url: string }) =>
    run(async () =>
      printResult(await controlRequest(opts.url, 'POST', `/control/${emulator}/faults/${fault}/arm`, parseParamsOption(opts.params))),
    )(),
  );

program
  .command('disarm <emulator> <fault>')
  .description('Disarm a fault')
  .option(...urlOption)
  .action((emulator: string, fault: string, opts: { url: string }) =>
    run(async () => printResult(await controlRequest(opts.url, 'POST', `/control/${emulator}/faults/${fault}/disarm`)))(),
  );

program
  .command('state <emulator> <view>')
  .description('Read a state view')
  .option(...urlOption)
  .action((emulator: string, view: string, opts: { url: string }) =>
    run(async () => printResult(await controlRequest(opts.url, 'GET', `/control/${emulator}/state/${view}`)))(),
  );

program
  .command('seed <emulator> <name>')
  .description('Run a seeder')
  .option('-p, --params <json>', 'seeder params as JSON')
  .option(...urlOption)
  .action((emulator: string, name: string, opts: { params?: string; url: string }) =>
    run(async () =>
      printResult(await controlRequest(opts.url, 'POST', `/control/${emulator}/seed/${name}`, parseParamsOption(opts.params))),
    )(),
  );

const scenario = program.command('scenario').description('Run declarative scenario files');
scenario
  .command('run <file>')
  .description('Run a local scenario .yaml against a running host')
  .option(...urlOption)
  .action((file: string, opts: { url: string }) =>
    run(async () => printResult(await controlRequest(opts.url, 'POST', '/control/scenario', loadScenarioFile(file))))(),
  );
scenario
  .command('list')
  .description('List scenarios loaded into the host')
  .option(...urlOption)
  .action((opts: { url: string }) => run(async () => printResult(await controlRequest(opts.url, 'GET', '/control/scenarios')))());
scenario
  .command('play <name>')
  .description('Run a scenario already loaded into the host')
  .option(...urlOption)
  .action((name: string, opts: { url: string }) =>
    run(async () => printResult(await controlRequest(opts.url, 'POST', `/control/scenarios/${name}/run`)))(),
  );

program.parseAsync().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
