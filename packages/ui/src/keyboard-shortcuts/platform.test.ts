/* @vitest-environment node */

import { describe, expect, it } from 'vitest';
import { detectClientPlatform, detectPlatformFromString } from './platform';

describe('keyboard shortcut platform detection', () => {
  it('classifies mac platforms from an explicit platform string', () => {
    expect(detectPlatformFromString('MacIntel')).toBe('mac');
    expect(detectPlatformFromString('iPad')).toBe('mac');
  });

  it('classifies non-mac and missing platforms as other', () => {
    expect(detectPlatformFromString('Win32')).toBe('other');
    expect(detectPlatformFromString('Linux x86_64')).toBe('other');
    expect(detectPlatformFromString(undefined)).toBe('other');
  });

  it('does not touch navigator on the SSR/node path', () => {
    expect(detectClientPlatform()).toBeNull();
  });
});
