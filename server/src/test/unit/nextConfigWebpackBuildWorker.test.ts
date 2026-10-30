import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('application Next.js production build memory', () => {
  it('compiles each webpack compiler in its own build worker despite the custom webpack config', async () => {
    const { default: nextConfig } = await import('../../../next.config.mjs');

    // Next's own rule (next/dist/build): the build worker is used when the
    // option is set, or when it is unset and there is no custom `webpack`.
    // With a custom `webpack` and no opt-in, server, edge and client all
    // compile in one process and their memory accumulates.
    const nextBuild = readFileSync(require.resolve('next/dist/build/index.js'), 'utf8');
    expect(nextBuild).toContain(
      'config.experimental.webpackBuildWorker || config.experimental.webpackBuildWorker === undefined && !config.webpack',
    );

    const experimental = nextConfig.experimental ?? {};
    const usesBuildWorker = Boolean(
      experimental.webpackBuildWorker || (experimental.webpackBuildWorker === undefined && !nextConfig.webpack),
    );

    expect(typeof nextConfig.webpack).toBe('function');
    expect(usesBuildWorker).toBe(true);
  });
});
