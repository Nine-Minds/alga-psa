import { describe, expect, it, vi } from 'vitest';
import { resolveNextDevBundlerOptions, startDevServer } from '../../../dev-server';

describe('custom development server bundler selection', () => {
  it('selects Webpack when the ordinary dev command leaves Turbopack unset', () => {
    expect(resolveNextDevBundlerOptions({}, {})).toEqual({ webpack: true });
  });

  it('passes the default Webpack selection to Next when starting the custom server', async () => {
    vi.stubEnv('DEV_TURBOPACK', '');
    try {
      const nextOptions: Record<string, unknown>[] = [];
      const nextFactory = (options: Record<string, unknown>) => {
        nextOptions.push(options);
        return {
          prepare: async () => undefined,
          getRequestHandler: () => async () => undefined,
          upgradeHandler: () => undefined,
          close: async () => undefined,
        };
      };
      const running = await startDevServer(
        { port: 0, hostname: '127.0.0.1' },
        nextFactory,
      );
      try {
        expect(nextOptions).toHaveLength(1);
        expect(nextOptions[0]).toEqual(expect.objectContaining({
          dev: true,
          webpack: true,
        }));
        expect(nextOptions[0]).not.toHaveProperty('turbopack');
      } finally {
        await running.close();
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('selects Turbopack only when explicitly enabled for the turbo dev command', () => {
    expect(resolveNextDevBundlerOptions({}, { DEV_TURBOPACK: '1' })).toEqual({ turbopack: true });
  });

  it('honors an explicit per-server bundler selection over the environment default', () => {
    expect(resolveNextDevBundlerOptions({ webpack: true }, { DEV_TURBOPACK: '1' })).toEqual({ webpack: true });
    expect(resolveNextDevBundlerOptions({ turbopack: true }, {})).toEqual({ turbopack: true });
  });

  it('rejects simultaneous explicit bundler selection', () => {
    expect(() => resolveNextDevBundlerOptions(
      { turbopack: true, webpack: true },
      {},
    )).toThrow('Development server cannot enable Webpack and Turbopack together');
  });
});
