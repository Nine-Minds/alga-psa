import { describe, expect, it } from 'vitest';
import { resolveNextDevBundlerOptions } from '../../../dev-server';

describe('custom development server bundler selection', () => {
  it('selects Webpack when the ordinary dev command leaves Turbopack unset', () => {
    expect(resolveNextDevBundlerOptions({}, {})).toEqual({ webpack: true });
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
