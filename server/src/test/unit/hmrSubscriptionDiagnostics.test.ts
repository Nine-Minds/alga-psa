import { describe, expect, it, vi } from 'vitest';
import {
  installTurbopackHmrSubscriptionDiagnostics,
  type TurbopackBindings,
} from '../../../hmr-subscription-diagnostics';

describe('Turbopack HMR subscription diagnostics', () => {
  async function instrument(
    clientHmrEvents: () => AsyncGenerator<unknown>,
    write: (line: string) => void,
  ) {
    const bindings: TurbopackBindings = {
      getTargetTriple: () => 'test',
      turbo: {
        createProject: async () => ({ value: { clientHmrEvents } }),
      },
    };
    await installTurbopackHmrSubscriptionDiagnostics(async () => bindings, write);
    return (await bindings.turbo.createProject({})).value;
  }

  it('forwards events and closes the native iterator when the diagnostic writer fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const closed = vi.fn();
    const event = { value: { type: 'restart' } };
    const writer = vi.fn((): void => { throw new Error('closed diagnostic sink'); })
      .mockImplementationOnce(() => undefined);
    try {
      const project = await instrument(async function* () {
        try {
          yield event;
          yield event;
        } finally {
          closed();
        }
      }, writer);
      for await (const received of project.clientHmrEvents('shared.js')) {
        expect(received).toBe(event);
        break;
      }
      expect(closed).toHaveBeenCalledOnce();
      expect(writer).toHaveBeenCalledTimes(2);
      expect(warning).toHaveBeenCalledOnce();
    } finally {
      warning.mockRestore();
    }
  });

  it('records native iterator rejection and preserves the original error', async () => {
    const failure = new Error('native subscription failed');
    const lines: string[] = [];
    const project = await instrument(async function* () {
      throw failure;
    }, (line) => lines.push(line));
    await expect(project.clientHmrEvents('shared.js').next()).rejects.toBe(failure);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({
      phase: 'rejected',
      sequence: 0,
      chunkName: 'shared.js',
      error: String(failure),
    });
  });

  it('distinguishes subscriptions to the same chunk', async () => {
    const lines: string[] = [];
    const project = await instrument(async function* () {
      yield { value: { type: 'issues' } };
    }, (line) => lines.push(line));
    for (let i = 0; i < 2; i++) {
      const subscription = project.clientHmrEvents('shared.js');
      await subscription.next();
      await subscription.return?.();
    }
    const initial = lines.map((line) => JSON.parse(line))
      .filter((entry) => entry.phase === 'initial');
    expect(initial).toHaveLength(2);
    expect(initial[0].subscriptionId).not.toBe(initial[1].subscriptionId);
  });

  it('records and forwards the initial event and every subsequent native event', async () => {
    const events = [
      {
        value: {
          type: 'restart',
          resource: { path: 'static/chunks/shared.js' },
        },
      },
      { value: { type: 'partial', instruction: { type: 'replace' } } },
    ];
    const originalProject = {
      clientHmrEvents: () =>
        (async function* () {
          yield* events;
        })(),
    };
    const bindings: TurbopackBindings = {
      getTargetTriple: () => 'x86_64-unknown-linux-gnu',
      turbo: {
        createProject: async () => ({ value: originalProject }),
      },
    };
    const lines: string[] = [];

    await installTurbopackHmrSubscriptionDiagnostics(
      async () => bindings,
      (line) => lines.push(line),
    );
    const projectResult = await bindings.turbo.createProject({
      rootPath: '/repo',
      projectPath: 'server',
      distDir: '.next-dev',
    });
    const received: unknown[] = [];
    for await (const event of projectResult.value.clientHmrEvents(
      'static/chunks/shared.js',
    )) {
      received.push(event);
    }

    expect(received).toEqual(events);
    const diagnostics = lines.map((line) => JSON.parse(line));
    expect(diagnostics[0].targetTriple).toBe('x86_64-unknown-linux-gnu');
    expect(diagnostics.map((entry) => entry.phase)).toEqual([
      'installed',
      'initial',
      'stream',
      'complete',
    ]);
    expect(diagnostics.slice(1, 3).map((entry) => entry.value)).toEqual(events);
    expect(
      diagnostics
        .slice(1, 3)
        .every(
          (entry) =>
            entry.chunkName === 'static/chunks/shared.js' &&
            entry.rootPath === '/repo' &&
            entry.projectPath === 'server' &&
            entry.distDir === '.next-dev',
        ),
    ).toBe(true);
  });
});
