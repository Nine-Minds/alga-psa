import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ControlError } from './registry';
import { parseScenario, runScenario } from './scenario';
import type { EmulatorHost } from './host';

/**
 * Route errors (sync and async) to the error middleware explicitly, so
 * behavior does not depend on Express 5's automatic rejection forwarding.
 */
export function route(fn: (req: Request, res: Response) => void | Promise<void>): RequestHandler {
  return (req, res, next) => {
    try {
      Promise.resolve(fn(req, res)).catch(next);
    } catch (err) {
      next(err);
    }
  };
}

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

  app.get('/control/catalog', route((_req, res) => {
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
  }));

  app.get('/control/clock', route((_req, res) => {
    res.json({ ok: true, result: { now: host.clock.now().toISOString(), offsetMs: host.clock.offset } });
  }));

  app.post('/control/clock/advance', route((req, res) => {
    const duration: unknown = req.body?.duration;
    if (typeof duration !== 'string' && typeof duration !== 'number') {
      throw new ControlError(400, 'Body must be {"duration": "<32d | 4h30m | ms number>"}');
    }
    host.clock.advance(duration);
    res.json({ ok: true, result: { now: host.clock.now().toISOString(), offsetMs: host.clock.offset } });
  }));

  app.get('/control/scenarios', route((_req, res) => {
    res.json({
      ok: true,
      result: [...host.scenarios.values()].map(({ name, description, steps }) => ({
        name,
        description: description ?? null,
        stepCount: steps.length,
      })),
    });
  }));

  app.post('/control/scenarios/:name/run', route(async (req, res) => {
    const steps = await runScenario(host, host.scenario(req.params.name));
    res.json({ ok: true, result: { steps } });
  }));

  app.post('/control/scenario', route(async (req, res) => {
    const scenario = parseScenario(req.body);
    const steps = await runScenario(host, scenario);
    res.json({ ok: true, result: { steps } });
  }));

  app.post('/control/:emu/reset', route(async (req, res) => {
    await host.reset(req.params.emu);
    host.persistState();
    res.json({ ok: true, result: null });
  }));

  app.post('/control/:emu/actions/:name', route(async (req, res) => {
    const result = await host.instance(req.params.emu).controls.runAction(req.params.name, req.body);
    host.recordStep({ emulator: req.params.emu, kind: 'action', name: req.params.name, params: req.body });
    host.persistState();
    res.json({ ok: true, result: result ?? null });
  }));

  app.post('/control/:emu/faults/:name/arm', route(async (req, res) => {
    await host.instance(req.params.emu).controls.armFault(req.params.name, req.body);
    host.recordStep({ emulator: req.params.emu, kind: 'arm', name: req.params.name, params: req.body });
    host.persistState();
    res.json({ ok: true, result: null });
  }));

  app.post('/control/:emu/faults/:name/disarm', route(async (req, res) => {
    await host.instance(req.params.emu).controls.disarmFault(req.params.name);
    host.recordStep({ emulator: req.params.emu, kind: 'disarm', name: req.params.name });
    host.persistState();
    res.json({ ok: true, result: null });
  }));

  app.get('/control/:emu/state/:view', route((req, res) => {
    const state = host.instance(req.params.emu).controls.readState(req.params.view);
    res.json({ ok: true, result: state ?? null });
  }));

  app.post('/control/:emu/seed/:name', route(async (req, res) => {
    const result = await host.instance(req.params.emu).controls.runSeeder(req.params.name, req.body);
    host.recordStep({ emulator: req.params.emu, kind: 'seed', name: req.params.name, params: req.body });
    host.persistState();
    res.json({ ok: true, result: result ?? null });
  }));

  // Scenario record mode: hand back everything captured so far as a scenario
  // document that `algasim scenario run` replays verbatim.
  app.get('/control/recording', route((_req, res) => {
    res.json({
      ok: true,
      result: {
        enabled: host.recordingEnabled,
        scenario: {
          name: 'recorded',
          description: 'Captured from live control calls',
          steps: host.recordedSteps.map((step) => ({
            // Scenario targets are "<emulator>/<control>"; disarm takes no params.
            [step.kind]: `${step.emulator}/${step.name}`,
            ...(step.kind !== 'disarm' && step.params && Object.keys(step.params as object).length > 0
              ? { params: step.params }
              : {}),
          })),
        },
      },
    });
  }));

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
