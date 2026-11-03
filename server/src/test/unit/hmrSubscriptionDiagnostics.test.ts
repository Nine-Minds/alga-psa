import { describe, expect, it } from 'vitest';
import {
  installTurbopackHmrSubscriptionDiagnostics,
  type TurbopackBindings,
} from '../../../hmr-subscription-diagnostics';

describe('Turbopack HMR subscription diagnostics', () => {
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
