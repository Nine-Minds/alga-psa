import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { ControlError } from './registry';
import { parseScenario, runScenario } from './scenario';
import type { EmulatorHost } from './host';

function consoleDir(): string {
  // dist/*.js (ESM), dist/*.cjs, and src/*.ts all sit one level below the
  // package root, so ../console resolves from any of them.
  if (typeof __dirname !== 'undefined') {
    return join(__dirname, '../console');
  }
  return join(dirname(fileURLToPath(import.meta.url)), '../console');
}

/**
 * The uniform control surface. Everything here is generated from emulator
 * registrations; adding a control to an emulator package is all it takes to
 * expose it over HTTP (and therefore to the CLI and console).
 */
export function buildControlApp(host: EmulatorHost): express.Express {
  const app = express();
  app.use(express.json());
  app.use(express.static(consoleDir()));

  app.get('/control/catalog', (_req, res) => {
    res.json({
      ok: true,
      result: {
        clock: { now: host.clock.now().toISOString(), offsetMs: host.clock.offset },
        emulators: host.emulators.map((instance) => ({
          id: instance.pkg.id,
          displayName: instance.pkg.displayName,
          port: instance.port,
          ...instance.controls.catalog(),
        })),
      },
    });
  });

  app.get('/control/clock', (_req, res) => {
    res.json({ ok: true, result: { now: host.clock.now().toISOString(), offsetMs: host.clock.offset } });
  });

  app.post('/control/clock/advance', (req, res) => {
    const duration: unknown = req.body?.duration;
    if (typeof duration !== 'string' && typeof duration !== 'number') {
      throw new ControlError(400, 'Body must be {"duration": "<32d | 4h30m | ms number>"}');
    }
    host.clock.advance(duration);
    res.json({ ok: true, result: { now: host.clock.now().toISOString(), offsetMs: host.clock.offset } });
  });

  app.get('/control/scenarios', (_req, res) => {
    res.json({
      ok: true,
      result: [...host.scenarios.values()].map(({ name, description, steps }) => ({
        name,
        description: description ?? null,
        stepCount: steps.length,
      })),
    });
  });

  app.post('/control/scenarios/:name/run', async (req, res) => {
    const steps = await runScenario(host, host.scenario(req.params.name));
    res.json({ ok: true, result: { steps } });
  });

  app.post('/control/scenario', async (req, res) => {
    const scenario = parseScenario(req.body);
    const steps = await runScenario(host, scenario);
    res.json({ ok: true, result: { steps } });
  });

  app.post('/control/:emu/reset', async (req, res) => {
    await host.reset(req.params.emu);
    res.json({ ok: true, result: null });
  });

  app.post('/control/:emu/actions/:name', async (req, res) => {
    const result = await host.instance(req.params.emu).controls.runAction(req.params.name, req.body);
    res.json({ ok: true, result: result ?? null });
  });

  app.post('/control/:emu/faults/:name/arm', async (req, res) => {
    await host.instance(req.params.emu).controls.armFault(req.params.name, req.body);
    res.json({ ok: true, result: null });
  });

  app.post('/control/:emu/faults/:name/disarm', async (req, res) => {
    await host.instance(req.params.emu).controls.disarmFault(req.params.name);
    res.json({ ok: true, result: null });
  });

  app.get('/control/:emu/state/:view', (req, res) => {
    const state = host.instance(req.params.emu).controls.readState(req.params.view);
    res.json({ ok: true, result: state ?? null });
  });

  app.post('/control/:emu/seed/:name', async (req, res) => {
    const result = await host.instance(req.params.emu).controls.runSeeder(req.params.name, req.body);
    res.json({ ok: true, result: result ?? null });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ControlError) {
      res.status(err.status).json({ ok: false, error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  });

  return app;
}
